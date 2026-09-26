import json
import unittest

from voice_host.live.agent import LiveConversation, _warm_tts
from voice_host.live.voice_errors import (
    VOICE_ERROR_TOPIC,
    encode_voice_error_event,
    publish_voice_error_event,
)


class VoiceErrorContractTests(unittest.TestCase):
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
        self.assertNotIn("causeCategory", event)
        self.assertNotIn("transcript", event["detail"])
        with self.assertRaises(ValueError):
            encode_voice_error_event(
                session_id="ses_123",
                sequence=2,
                stage="stt",
                code="SESSION_AGENT_ERROR",
            )


class VoiceErrorPublishingTests(unittest.IsolatedAsyncioTestCase):
    async def test_errors_publish_in_sequence_over_the_reliable_agent_data_topic(self):
        class Participant:
            def __init__(self):
                self.published = []

            async def publish_data(self, payload, **options):
                self.published.append((json.loads(payload), options))

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
            )
        )
        event, options = participant.published[0]
        self.assertEqual(event["code"], "STT_PROVIDER_UNAVAILABLE")
        self.assertEqual(options, {"reliable": True, "topic": VOICE_ERROR_TOPIC})


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
