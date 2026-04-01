import sqlite3

# Connect to your existing database
conn = sqlite3.connect('crm.db')
cursor = conn.cursor()

# Add the new column
cursor.execute('ALTER TABLE customers ADD COLUMN summary TEXT')

conn.commit()
conn.close()

print("Summary column added successfully!")