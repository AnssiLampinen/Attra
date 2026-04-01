import time
from beeper_desktop_api import BeeperDesktop

client = BeeperDesktop(access_token="4d568fbf-7b7a-473b-bf88-0b6f2d7f9060")
seen_ids = set()

print("Listening for new messages... Press Ctrl+C to stop.")

while True:
    # Fetch the 5 most recent messages
    response = client.messages.search(limit=5)
    
    # Process them in reverse so the newest prints last
    for msg in reversed(response.items):
        if msg.id not in seen_ids:
            # Only print if we've already loaded the initial history
            if len(seen_ids) > 0:
                sender = msg.sender_name or "Unknown"
                text = msg.text or "[Attachment]"
                print(f"New from {sender}: {text}")
            
            # Mark as seen
            seen_ids.add(msg.id)
            
    # Wait 3 seconds before checking again
    time.sleep(3)

