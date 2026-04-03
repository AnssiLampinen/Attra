import sqlite3

# Connect to your existing database
conn = sqlite3.connect('crm.db')
cursor = conn.cursor()

# Add the new column
cursor.execute('ALTER TABLE customers DROP COLUMN messages')

conn.commit()
conn.close()

print("Messages column dropped successfully!")