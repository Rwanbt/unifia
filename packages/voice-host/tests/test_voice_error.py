import json
import unittest

from voice_host.live.agent import LiveConversation
from voice_host.live.voice_errors import VOICE_ERROR_TOPIC, encode_voice_error_event


class VoiceErrorContractTests(unittest.TestCase):
    def test_event_uses_contract_fields_and_only_registered_safe_details(self):
        event = json.loads(encode_voice_error_event(
            session_id="ses_123", sequence=1, stage="session", code="SESSION_AGENT_ERROR", turn_id="turn_1"
        ))
        self.assertEqual(event["kind"], "voice_error")
        self.assertEqual(event["stage"], "session")
        self.assertEqual(event["seq"], 1)
        self.assertEqual(event["turnID"], "turn_1")
        self.assertNotIn("transcript", event["detail"])
        with self.assertRaises(ValueError):
            encode_voice_error_event(
                session_id="ses_123", sequence=2, stage="stt", code="SESSION_AGENT_ERROR"
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
        conversation = LiveConversation(room=room, bridge=None, router=None, languages=None)
        self.assertTrue(await conversation.publish_voice_error("ses_123", "SESSION_AGENT_ERROR", "turn_1"))
        self.assertTrue(await conversation.publish_voice_error("ses_123", "SESSION_AGENT_ERROR", "turn_2"))
        self.assertEqual([item[0]["seq"] for item in room.local_participant.published], [1, 2])
        self.assertTrue(all(item[1] == {"reliable": True, "topic": VOICE_ERROR_TOPIC} for item in room.local_participant.published))

    async def test_publish_failure_is_reported_to_the_caller_for_legacy_fallback(self):
        class Participant:
            async def publish_data(self, _payload, **_options):
                raise RuntimeError("transport down")

        class Room:
            isconnected = True
            local_participant = Participant()

        conversation = LiveConversation(room=Room(), bridge=None, router=None, languages=None)
        self.assertFalse(await conversation.publish_voice_error("ses_123", "SESSION_AGENT_ERROR", "turn_1"))


if __name__ == "__main__":
    unittest.main()
