import json
import unittest
from unittest.mock import patch

from voice_host.live.agent import LiveConversation, _warm_tts
from voice_host.live.voice_errors import (
    VOICE_ERROR_TOPIC,
    VOICE_READY_TOPIC,
    encode_voice_error_event,
    encode_voice_ready_event,
    publish_voice_error_event,
    publish_voice_ready_event,
)


class VoiceErrorContractTests(unittest.TestCase):
    def test_events_use_a_safe_monotonic_timestamp(self):
        with (
            patch("voice_host.live.voice_errors.time.monotonic_ns", return_value=42_000_000),
            patch("voice_host.live.voice_errors.time.time_ns", return_value=99_000_000_000),
        ):
            error = json.loads(encode_voice_error_event(
                session_id="ses_123",
                sequence=0,
                stage="session",
                code="SESSION_AGENT_ERROR",
            ))
            ready = json.loads(encode_voice_ready_event(session_id="ses_123", sequence=1))

        self.assertEqual(error["ts"], 42)
        self.assertEqual(ready["ts"], 42)

    def test_events_reject_an_unsafe_monotonic_timestamp(self):
        with patch(
            "voice_host.live.voice_errors.time.monotonic_ns",
            return_value=(9_007_199_254_740_992 * 1_000_000),
        ):
            with self.assertRaises(ValueError):
                encode_voice_error_event(
                    session_id="ses_123",
                    sequence=0,
                    stage="session",
                    code="SESSION_AGENT_ERROR",
                )

    def test_event_uses_contract_fields_and_only_registered_safe_details(self):
        event = json.loads(
            encode_voice_error_event(
                session_id="ses_123",
                sequence=1,
                stage="session",
                code="SESSION_AGENT_ERROR",
                turn_id="turn_1",
            )
        )
        self.assertEqual(event["kind"], "voice_error")
        self.assertEqual(event["stage"], "session")
        self.assertEqual(event["seq"], 1)
        self.assertEqual(event["turnID"], "turn_1")
        self.assertEqual(event["cause_category"], "session")
        self.assertNotIn("transcript", event["detail"])
        with self.assertRaises(ValueError):
            encode_voice_error_event(
                session_id="ses_123",
                sequence=2,
                stage="stt",
                code="SESSION_AGENT_ERROR",
            )

    def test_pre_session_error_uses_a_valid_binding_instead_of_a_session_id(self):
        binding_id = "lvb_" + "1" * 32
        event = json.loads(
            encode_voice_error_event(
                binding_id=binding_id,
                sequence=0,
                stage="provider",
                code="PROVIDER_BINDING_INVALID",
            )
        )
        self.assertEqual(event["bindingID"], binding_id)
        self.assertNotIn("sessionID", event)
        with self.assertRaises(ValueError):
            encode_voice_error_event(
                session_id="ses_123",
                binding_id=binding_id,
                sequence=0,
                stage="provider",
                code="PROVIDER_BINDING_INVALID",
            )

    def test_ready_event_requires_a_session_and_has_canonical_fields(self):
        event = json.loads(encode_voice_ready_event(session_id="ses_123", sequence=2))
        self.assertEqual(event["kind"], "voice_ready")
        self.assertEqual(event["profile"], "live")
        self.assertEqual(event["seq"], 2)
        with self.assertRaises(ValueError):
            encode_voice_ready_event(session_id="binding_123", sequence=2)

    def test_every_error_stage_has_a_registered_safe_event(self):
        expected = {
            "audio-input", "audio-output", "permission", "model-missing", "model-download",
            "integrity", "model-load", "vad", "turn-detection", "stt", "session", "provider",
            "llm", "tool", "tts", "resource", "thermal", "network", "unsupported-capability",
            "abi", "logging",
        }
        from voice_host.live.voice_errors import _SAFE_ERRORS

        self.assertEqual({stage for stage, _code in _SAFE_ERRORS}, expected)
        for stage, code in _SAFE_ERRORS:
            with self.subTest(stage=stage, code=code):
                event = json.loads(encode_voice_error_event(
                    session_id="ses_123", sequence=1, stage=stage, code=code
                ))
                self.assertEqual(event["stage"], stage)
                self.assertIn(event["cause_category"], {
                    "permission", "device", "availability", "provider", "session", "network", "programmer",
                })

    def test_provider_identity_is_validated_and_serialized(self):
        event = json.loads(encode_voice_error_event(
            session_id="ses_123", sequence=1, stage="stt",
            code="STT_PROVIDER_UNAVAILABLE", provider_id="parakeet@1.0",
        ))
        self.assertEqual(event["provider_id"], "parakeet@1.0")
        with self.assertRaises(ValueError):
            encode_voice_error_event(
                session_id="ses_123", sequence=1, stage="stt",
                code="STT_PROVIDER_UNAVAILABLE", provider_id="Authorization: secret",
            )


class VoiceErrorPublishingTests(unittest.IsolatedAsyncioTestCase):
    async def test_errors_publish_in_sequence_over_the_reliable_agent_data_topic(self):
        class Participant:
            def __init__(self):
                self.published = []
                self.attributes = {}

            async def publish_data(self, payload, **options):
                self.published.append((json.loads(payload), options))

            async def set_attributes(self, attributes):
                self.attributes.update(attributes)

        class Room:
            isconnected = True

            def __init__(self):
                self.local_participant = Participant()

        room = Room()
        conversation = LiveConversation(
            room=room, bridge=None, router=None, languages=None
        )
        self.assertTrue(
            await conversation.publish_voice_error(
                "ses_123", "SESSION_AGENT_ERROR", "turn_1"
            )
        )
        self.assertTrue(
            await conversation.publish_voice_error(
                "ses_123", "SESSION_AGENT_ERROR", "turn_2"
            )
        )
        self.assertEqual(
            [item[0]["seq"] for item in room.local_participant.published], [1, 2]
        )
        self.assertTrue(
            all(
                item[1] == {"reliable": True, "topic": VOICE_ERROR_TOPIC}
                for item in room.local_participant.published
            )
        )
        self.assertTrue(await conversation.publish_voice_ready("ses_123"))
        ready, options = room.local_participant.published[-1]
        self.assertEqual(ready["kind"], "voice_ready")
        self.assertEqual(ready["seq"], 3)
        self.assertEqual(options, {"reliable": True, "topic": VOICE_READY_TOPIC})
        self.assertEqual(
            json.loads(room.local_participant.attributes["unifia.voice_ready"]), ready
        )

    async def test_publish_failure_is_reported_to_the_caller_for_legacy_fallback(self):
        class Participant:
            async def publish_data(self, _payload, **_options):
                raise RuntimeError("transport down")

        class Room:
            isconnected = True
            local_participant = Participant()

        conversation = LiveConversation(
            room=Room(), bridge=None, router=None, languages=None
        )
        self.assertFalse(
            await conversation.publish_voice_error(
                "ses_123", "SESSION_AGENT_ERROR", "turn_1"
            )
        )

    async def test_startup_stt_error_uses_the_same_safe_reliable_event_encoder(self):
        class Participant:
            def __init__(self):
                self.published = []

            async def publish_data(self, payload, **options):
                self.published.append((json.loads(payload), options))

        participant = Participant()
        self.assertTrue(
            await publish_voice_error_event(
                participant,
                session_id="ses_123",
                sequence=0,
                stage="stt",
                code="STT_PROVIDER_UNAVAILABLE",
                provider_id="parakeet",
            )
        )
        event, options = participant.published[0]
        self.assertEqual(event["code"], "STT_PROVIDER_UNAVAILABLE")
        self.assertEqual(event["provider_id"], "parakeet")
        self.assertEqual(options, {"reliable": True, "topic": VOICE_ERROR_TOPIC})

    async def test_ready_event_uses_data_and_persistent_attribute_channels(self):
        class Participant:
            def __init__(self):
                self.published = []
                self.attributes = {}

            async def publish_data(self, payload, **options):
                self.published.append((json.loads(payload), options))

            async def set_attributes(self, attributes):
                self.attributes.update(attributes)

        participant = Participant()
        self.assertTrue(
            await publish_voice_ready_event(
                participant, session_id="ses_123", sequence=1
            )
        )
        event, options = participant.published[0]
        self.assertEqual(
            event, json.loads(participant.attributes["unifia.voice_ready"])
        )
        self.assertEqual(options, {"reliable": True, "topic": VOICE_READY_TOPIC})

    async def test_pre_session_error_is_persisted_for_a_late_room_joiner(self):
        class Participant:
            def __init__(self):
                self.published = []
                self.attributes = {}

            async def publish_data(self, payload, **options):
                self.published.append((json.loads(payload), options))

            async def set_attributes(self, attributes):
                self.attributes.update(attributes)

        participant = Participant()
        binding_id = "lvb_" + "1" * 32
        self.assertTrue(await publish_voice_error_event(
            participant,
            binding_id=binding_id,
            sequence=0,
            stage="provider",
            code="PROVIDER_BINDING_INVALID",
        ))
        event, options = participant.published[0]
        self.assertEqual(event["bindingID"], binding_id)
        self.assertEqual(options, {"reliable": True, "topic": VOICE_ERROR_TOPIC})
        self.assertEqual(
            json.loads(participant.attributes["unifia.voice_error"]), event
        )


class TtsReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_warmup_uses_first_available_provider_before_marking_ready(self):
        class Backend:
            def __init__(self, fail):
                self.fail = fail

            async def prepare(self, _language, _voice):
                if self.fail:
                    raise RuntimeError("private provider diagnostic")

        class Router:
            backends = {"pocket": Backend(True), "piper": Backend(False)}

            def order(self):
                return ["pocket", "piper"]

        self.assertEqual(await _warm_tts(Router(), "en", {}), "piper")

    async def test_warmup_reports_unavailable_when_every_provider_fails(self):
        class Backend:
            async def prepare(self, _language, _voice):
                raise RuntimeError("private provider diagnostic")

        class Router:
            backends = {"pocket": Backend(), "piper": Backend()}

            def order(self):
                return ["pocket", "piper"]

        self.assertIsNone(await _warm_tts(Router(), "en", {}))


if __name__ == "__main__":
    unittest.main()
