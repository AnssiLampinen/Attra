import sqlite3


DB_PATH = "crm.db"

DESIRED_ORDER = [
    "id",
    "name",
    "phone",
    "summary",
    "status",
    "email",
    "whatsapp_id",
    "instagram_id",
    "messenger_id",
    "telegram_id",
    "signal_id",
    "twitter_id",
    "linkedin_id",
    "slack_id",
    "discord_id",
    "google_messages_id",
    "google_chat_id",
    "google_voice_id",
]

DROP_COLUMNS = {"messages"}


def _existing_columns(cursor: sqlite3.Cursor, table_name: str) -> list[str]:
    rows = cursor.execute(f"PRAGMA table_info({table_name})").fetchall()
    return [row[1] for row in rows]


def reorder_customers_table(db_path: str = DB_PATH) -> None:
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        tables = {
            row[0]
            for row in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "customers" not in tables:
            raise RuntimeError("customers table does not exist.")

        existing = _existing_columns(cursor, "customers")
        existing_set = set(existing)

        ordered_existing = [c for c in DESIRED_ORDER if c in existing_set]
        extra_columns = [c for c in existing if c not in ordered_existing and c not in DROP_COLUMNS]
        final_order = ordered_existing + extra_columns

        if not final_order:
            raise RuntimeError("No columns found on customers table.")

        cursor.execute("BEGIN")

        cursor.execute(
            """
            CREATE TABLE customers_new (
                id INTEGER PRIMARY KEY,
                name TEXT,
                phone TEXT,
                summary TEXT,
                status TEXT,
                email TEXT,
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
                google_voice_id TEXT
            )
            """
        )

        # Add any unexpected legacy columns so data is preserved.
        known_set = set(DESIRED_ORDER)
        for column in extra_columns:
            if column in known_set:
                continue
            cursor.execute(f'ALTER TABLE customers_new ADD COLUMN "{column}" TEXT')

        columns_sql = ", ".join(f'"{col}"' for col in final_order)
        cursor.execute(
            f"INSERT INTO customers_new ({columns_sql}) SELECT {columns_sql} FROM customers"
        )

        cursor.execute("DROP TABLE customers")
        cursor.execute("ALTER TABLE customers_new RENAME TO customers")
        conn.commit()
        print("Reordered customers table columns successfully.")
        print("New order:")
        print(", ".join(final_order))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    reorder_customers_table(DB_PATH)
