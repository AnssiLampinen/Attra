import sqlite3
import json
from dataclasses import asdict

# 1. Connect to the database
conn = sqlite3.connect('crm.db')
cursor = conn.cursor()

# 2. Create the table with a column for every Beeper network
cursor.execute('''
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY,
        name TEXT,
        phone TEXT,
        email TEXT,
        
        -- Beeper Supported Networks
        whatsapp_id TEXT,
        instagram_id TEXT,
        messenger_id TEXT,
        telegram_id TEXT,
        signal_id TEXT,
        twitter_id TEXT,
        linkedin_id TEXT,
        slack_id TEXT,
        discord_id TEXT,
        google_messages_id TEXT,
        google_chat_id TEXT,
        google_voice_id TEXT,
        
        messages TEXT,
        status TEXT,
        summary TEXT
    )
''')
conn.commit()

# 3. Save function updated to match the new columns
def save_customer(customer):
    cursor.execute('''
        INSERT OR REPLACE INTO customers 
        (id, name, phone, email, whatsapp_id, instagram_id, messenger_id, telegram_id, signal_id, twitter_id, linkedin_id, slack_id, discord_id, google_messages_id, google_chat_id, messages, status, summary) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        customer.customer_id, 
        customer.name, 
        customer.phone, 
        customer.email, 
        customer.whatsapp_id,
        customer.instagram_id,
        customer.messenger_id,
        customer.telegram_id,
        customer.signal_id,
        customer.twitter_id,
        customer.linkedin_id,
        customer.slack_id,
        customer.discord_id,
        customer.google_messages_id,
        customer.google_chat_id,
        json.dumps([asdict(m) for m in customer.messages]), 
        customer.status,
        customer.summary
    ))
    conn.commit()

def save_customer(customer):
    cursor.execute('''
        INSERT OR REPLACE INTO customers 
        (id, name, phone, email, whatsapp_id, instagram_id, messenger_id, telegram_id, signal_id, twitter_id, linkedin_id, slack_id, discord_id, google_messages_id, google_chat_id, messages, status, summary) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        customer.customer_id, 
        customer.name, 
        customer.phone, 
        customer.email, 
        customer.whatsapp_id,
        customer.instagram_id,
        customer.messenger_id,
        customer.telegram_id,
        customer.signal_id,
        customer.twitter_id,
        customer.linkedin_id,
        customer.slack_id,
        customer.discord_id,
        customer.google_messages_id,
        customer.google_chat_id,
        json.dumps([asdict(m) for m in customer.messages]), 
        customer.status,
        customer.summary
    ))
    conn.commit()