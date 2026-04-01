import itertools
from dataclasses import dataclass, field
from typing import List
from datetime import datetime

id_counter = itertools.count(1)

@dataclass
class Message:
    platform: str
    text: str
    is_from_customer: bool
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class Customer:
    name: str
    customer_id: int = field(default_factory=lambda: next(id_counter))
    phone: str = ""
    email: str = ""
    
    # Beeper Supported Networks
    whatsapp_id: str = ""
    instagram_id: str = ""
    messenger_id: str = ""
    telegram_id: str = ""
    signal_id: str = ""
    twitter_id: str = ""
    linkedin_id: str = ""
    slack_id: str = ""
    discord_id: str = ""
    google_messages_id: str = ""
    google_chat_id: str = ""
    google_voice_id: str = ""
    messages: List[Message] = field(default_factory=list)
    status: str = "unknown" 
    summary: str = ""       

    def log_message(self, platform: str, text: str, is_from_customer: bool = True):
        new_msg = Message(platform, text, is_from_customer)
        self.messages.append(new_msg)