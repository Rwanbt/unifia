/* SPDX-License-Identifier: MIT */
/*
 * jvm-host starts a JVM 21 inside its own process through JNI and runs one main method, in place of the
 * java launcher. On the phone the launcher's process is refused the JIT's executable-page probe
 * ("Failed to mark memory page as executable") under PRoot, while a process that calls
 * JNI_CreateJavaVM itself starts the same JVM. ADR-097 records the measurements.
 *
 * Usage: jvm-host [JVM options] [-cp <path>] <main class> [args...]
 *        jvm-host [JVM options] -jar <file.jar> [args...]
 *        jvm-host -version
 */
#include <jni.h>
#include <stdio.h>
#include <string.h>

#define MAX_JVM_OPTIONS 64
#define JVM_OPTION_CAPACITY 512
#define CLASS_PATH_CAPACITY 4096
#define MAIN_CLASS_CAPACITY 512
#define DEFAULT_CLASS_PATH "."
#define CLASS_PATH_OPTION_PREFIX "-Djava.class.path="
#define MANIFEST_MAIN_CLASS "Main-Class"
#define EXIT_OK 0
#define EXIT_LAUNCH_FAILURE 1
#define EXIT_USAGE 2
#define USAGE_TEXT "usage: jvm-host [JVM options] [-cp <path>] <main class> [args...] | -jar <file> [args...] | -version"

struct launch_request {
    const char *class_path;
    const char *jar_file;
    const char *main_class;
    int print_version;
    int app_argument_count;
    char **app_arguments;
    int jvm_option_count;
    char jvm_options[MAX_JVM_OPTIONS][JVM_OPTION_CAPACITY];
    char class_path_option[sizeof CLASS_PATH_OPTION_PREFIX + CLASS_PATH_CAPACITY];
};

static int usage_error(const char *message) {
    fprintf(stderr, "jvm-host: %s\n%s\n", message, USAGE_TEXT);
    return -1;
}

static int report_pending_exception(JNIEnv *env) {
    if (!(*env)->ExceptionCheck(env)) {
        return 0;
    }
    (*env)->ExceptionDescribe(env);
    (*env)->ExceptionClear(env);
    return 1;
}

static int is_class_path_flag(const char *token) {
    return strcmp(token, "-cp") == 0 || strcmp(token, "-classpath") == 0 || strcmp(token, "--class-path") == 0;
}

static int is_version_flag(const char *token) {
    return strcmp(token, "-version") == 0 || strcmp(token, "--version") == 0;
}

/* The launcher joins these two-token options into one JVM option, as the JVM's own syntax expects. */
static int is_separate_value_option(const char *token) {
    return strcmp(token, "--add-opens") == 0 || strcmp(token, "--add-modules") == 0
        || strcmp(token, "--add-exports") == 0 || strcmp(token, "--add-reads") == 0;
}

static int store_jvm_option(struct launch_request *request, const char *text) {
    if (request->jvm_option_count >= MAX_JVM_OPTIONS) {
        fprintf(stderr, "jvm-host: more than %d JVM options\n", MAX_JVM_OPTIONS);
        return -1;
    }
    if (strlen(text) >= JVM_OPTION_CAPACITY) {
        fprintf(stderr, "jvm-host: JVM option too long: %s\n", text);
        return -1;
    }
    strcpy(request->jvm_options[request->jvm_option_count], text);
    request->jvm_option_count++;
    return 0;
}

/* Returns how many arguments the option used (1 or 2), or 0 on error. */
static int consume_jvm_option(struct launch_request *request, int argc, char **argv, int index) {
    const char *token = argv[index];
    if (!is_separate_value_option(token) || index + 1 >= argc) {
        return store_jvm_option(request, token) == 0 ? 1 : 0;
    }
    char joined[JVM_OPTION_CAPACITY];
    int written = snprintf(joined, sizeof joined, "%s=%s", token, argv[index + 1]);
    if (written < 0 || (size_t)written >= sizeof joined) {
        fprintf(stderr, "jvm-host: JVM option too long: %s %s\n", token, argv[index + 1]);
        return 0;
    }
    return store_jvm_option(request, joined) == 0 ? 2 : 0;
}

static void set_application_arguments(struct launch_request *request, int argc, char **argv, int first) {
    request->app_argument_count = argc - first;
    request->app_arguments = argv + first;
}

static int parse_arguments(int argc, char **argv, struct launch_request *request) {
    int index = 1;
    while (index < argc) {
        const char *token = argv[index];
        if (is_class_path_flag(token)) {
            if (index + 1 >= argc) {
                return usage_error("missing class path");
            }
            request->class_path = argv[index + 1];
            index += 2;
        } else if (strcmp(token, "-jar") == 0) {
            if (index + 1 >= argc) {
                return usage_error("missing jar file after -jar");
            }
            request->jar_file = argv[index + 1];
            set_application_arguments(request, argc, argv, index + 2);
            return 0;
        } else if (is_version_flag(token)) {
            request->print_version = 1;
            index++;
        } else if (token[0] == '-') {
            int consumed = consume_jvm_option(request, argc, argv, index);
            if (consumed == 0) {
                return -1;
            }
            index += consumed;
        } else {
            request->main_class = token;
            set_application_arguments(request, argc, argv, index + 1);
            return 0;
        }
    }
    return 0;
}

static const char *effective_class_path(const struct launch_request *request) {
    if (request->jar_file != NULL) {
        return request->jar_file;
    }
    return request->class_path != NULL ? request->class_path : DEFAULT_CLASS_PATH;
}

static int create_vm(struct launch_request *request, JavaVM **vm, JNIEnv **env) {
    int written = snprintf(request->class_path_option, sizeof request->class_path_option, "%s%s",
                           CLASS_PATH_OPTION_PREFIX, effective_class_path(request));
    if (written < 0 || (size_t)written >= sizeof request->class_path_option) {
        fprintf(stderr, "jvm-host: class path too long\n");
        return -1;
    }
    JavaVMOption options[MAX_JVM_OPTIONS + 1];
    memset(options, 0, sizeof options);
    options[0].optionString = request->class_path_option;
    for (int index = 0; index < request->jvm_option_count; index++) {
        options[index + 1].optionString = request->jvm_options[index];
    }
    JavaVMInitArgs init_args;
    memset(&init_args, 0, sizeof init_args);
    init_args.version = JNI_VERSION_21;
    init_args.nOptions = request->jvm_option_count + 1;
    init_args.options = options;
    init_args.ignoreUnrecognized = JNI_FALSE;
    jint result = JNI_CreateJavaVM(vm, (void **)env, &init_args);
    if (result != JNI_OK) {
        fprintf(stderr, "jvm-host: JNI_CreateJavaVM returned %d\n", (int)result);
        return -1;
    }
    return 0;
}

static int to_internal_name(const char *dotted, char *internal, size_t capacity) {
    size_t length = strlen(dotted);
    if (length + 1 > capacity) {
        return -1;
    }
    for (size_t index = 0; index <= length; index++) {
        internal[index] = dotted[index] == '.' ? '/' : dotted[index];
    }
    return 0;
}

static jobjectArray new_string_array(JNIEnv *env, int count, char **values) {
    jclass string_class = (*env)->FindClass(env, "java/lang/String");
    if (string_class == NULL) {
        return NULL;
    }
    jobjectArray array = (*env)->NewObjectArray(env, count, string_class, NULL);
    for (int index = 0; array != NULL && index < count; index++) {
        jstring element = (*env)->NewStringUTF(env, values[index]);
        if (element == NULL) {
            return NULL;
        }
        (*env)->SetObjectArrayElement(env, array, index, element);
        (*env)->DeleteLocalRef(env, element);
    }
    return array;
}

static int run_main_class(JNIEnv *env, const char *dotted_name, int argc, char **argv) {
    char internal[MAIN_CLASS_CAPACITY];
    if (to_internal_name(dotted_name, internal, sizeof internal) != 0) {
        fprintf(stderr, "Error: main class name too long: %s\n", dotted_name);
        return EXIT_LAUNCH_FAILURE;
    }
    jclass main_class = (*env)->FindClass(env, internal);
    if (main_class == NULL) {
        (*env)->ExceptionClear(env);
        fprintf(stderr, "Error: Could not find or load main class %s\n", dotted_name);
        return EXIT_LAUNCH_FAILURE;
    }
    jmethodID main_method = (*env)->GetStaticMethodID(env, main_class, "main", "([Ljava/lang/String;)V");
    if (main_method == NULL) {
        report_pending_exception(env);
        fprintf(stderr, "Error: Main method not found in class %s\n", dotted_name);
        return EXIT_LAUNCH_FAILURE;
    }
    jobjectArray arguments = new_string_array(env, argc, argv);
    if (arguments == NULL) {
        report_pending_exception(env);
        return EXIT_LAUNCH_FAILURE;
    }
    (*env)->CallStaticVoidMethod(env, main_class, main_method, arguments);
    return report_pending_exception(env) ? EXIT_LAUNCH_FAILURE : EXIT_OK;
}

static jobject jar_manifest_attributes(JNIEnv *env, const char *jar_path) {
    jclass jar_class = (*env)->FindClass(env, "java/util/jar/JarFile");
    jmethodID constructor = jar_class == NULL ? NULL
        : (*env)->GetMethodID(env, jar_class, "<init>", "(Ljava/lang/String;)V");
    jstring path = constructor == NULL ? NULL : (*env)->NewStringUTF(env, jar_path);
    jobject jar = path == NULL ? NULL : (*env)->NewObject(env, jar_class, constructor, path);
    jmethodID get_manifest = jar == NULL ? NULL
        : (*env)->GetMethodID(env, jar_class, "getManifest", "()Ljava/util/jar/Manifest;");
    jobject manifest = get_manifest == NULL ? NULL : (*env)->CallObjectMethod(env, jar, get_manifest);
    jclass manifest_class = manifest == NULL ? NULL : (*env)->FindClass(env, "java/util/jar/Manifest");
    jmethodID get_attributes = manifest_class == NULL ? NULL
        : (*env)->GetMethodID(env, manifest_class, "getMainAttributes", "()Ljava/util/jar/Attributes;");
    return get_attributes == NULL ? NULL : (*env)->CallObjectMethod(env, manifest, get_attributes);
}

static int read_main_class_from_jar(JNIEnv *env, const char *jar_path, char *main_class, size_t capacity) {
    jobject attributes = jar_manifest_attributes(env, jar_path);
    if (attributes == NULL) {
        report_pending_exception(env);
        fprintf(stderr, "Error: cannot read the manifest of %s\n", jar_path);
        return -1;
    }
    jclass attributes_class = (*env)->FindClass(env, "java/util/jar/Attributes");
    jmethodID get_value = attributes_class == NULL ? NULL
        : (*env)->GetMethodID(env, attributes_class, "getValue", "(Ljava/lang/String;)Ljava/lang/String;");
    jstring key = get_value == NULL ? NULL : (*env)->NewStringUTF(env, MANIFEST_MAIN_CLASS);
    jstring value = key == NULL ? NULL : (jstring)(*env)->CallObjectMethod(env, attributes, get_value, key);
    if (value == NULL) {
        report_pending_exception(env);
        fprintf(stderr, "no main manifest attribute, in %s\n", jar_path);
        return -1;
    }
    const char *utf = (*env)->GetStringUTFChars(env, value, NULL);
    if (utf == NULL || strlen(utf) >= capacity) {
        if (utf != NULL) {
            (*env)->ReleaseStringUTFChars(env, value, utf);
        }
        fprintf(stderr, "Error: main class name too long in %s\n", jar_path);
        return -1;
    }
    strcpy(main_class, utf);
    (*env)->ReleaseStringUTFChars(env, value, utf);
    return 0;
}

static int print_java_version(JNIEnv *env) {
    jclass system_class = (*env)->FindClass(env, "java/lang/System");
    jmethodID get_property = system_class == NULL ? NULL
        : (*env)->GetStaticMethodID(env, system_class, "getProperty", "(Ljava/lang/String;)Ljava/lang/String;");
    jstring key = get_property == NULL ? NULL : (*env)->NewStringUTF(env, "java.version");
    jstring value = key == NULL ? NULL
        : (jstring)(*env)->CallStaticObjectMethod(env, system_class, get_property, key);
    if (value == NULL) {
        report_pending_exception(env);
        return EXIT_LAUNCH_FAILURE;
    }
    const char *utf = (*env)->GetStringUTFChars(env, value, NULL);
    if (utf == NULL) {
        return EXIT_LAUNCH_FAILURE;
    }
    fprintf(stderr, "openjdk version \"%s\"\n", utf);
    (*env)->ReleaseStringUTFChars(env, value, utf);
    return EXIT_OK;
}

static int run_request(JNIEnv *env, const struct launch_request *request) {
    if (request->print_version) {
        return print_java_version(env);
    }
    char jar_main_class[MAIN_CLASS_CAPACITY];
    const char *main_name = request->main_class;
    if (request->jar_file != NULL) {
        if (read_main_class_from_jar(env, request->jar_file, jar_main_class, sizeof jar_main_class) != 0) {
            return EXIT_LAUNCH_FAILURE;
        }
        main_name = jar_main_class;
    }
    return run_main_class(env, main_name, request->app_argument_count, request->app_arguments);
}

int main(int argc, char **argv) {
    struct launch_request request;
    memset(&request, 0, sizeof request);
    if (parse_arguments(argc, argv, &request) != 0) {
        return EXIT_USAGE;
    }
    if (!request.print_version && request.main_class == NULL && request.jar_file == NULL) {
        usage_error("no main class or jar file given");
        return EXIT_USAGE;
    }
    JavaVM *vm = NULL;
    JNIEnv *env = NULL;
    if (create_vm(&request, &vm, &env) != 0) {
        return EXIT_LAUNCH_FAILURE;
    }
    int status = run_request(env, &request);
    jint destroy_result = (*vm)->DestroyJavaVM(vm);
    if (destroy_result != JNI_OK) {
        fprintf(stderr, "jvm-host: DestroyJavaVM returned %d\n", (int)destroy_result);
        return EXIT_LAUNCH_FAILURE;
    }
    return status;
}
