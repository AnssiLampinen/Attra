"""
config.py

Thin module that exposes configuration values derived from environment
variables. Imported by ingest_beeper_messages.py.

  USER_NAME — your name as it should appear in AI-generated summaries
              (e.g. "Anssi"). Defaults to "you" if not set.
              Controlled by the ATTRA_USER_NAME environment variable.
"""

import os

USER_NAME = os.getenv("ATTRA_USER_NAME", "you")
