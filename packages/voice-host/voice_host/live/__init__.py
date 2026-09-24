"""LiveKit voice conversation host.

LiveKit carries audio, VAD and turn-taking. Every user turn is handed to the
existing Unifia session through the server's HTTP API; this package never owns
tools, permissions, memory or model selection.
"""
