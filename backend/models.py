from tortoise import fields
from tortoise.models import Model
import uuid

class User(Model):
    """User account stored in SQLite database."""

    id = fields.UUIDField(pk=True, default=uuid.uuid4)
    username = fields.CharField(max_length=50, unique=True, index=True)
    password_hash = fields.CharField(max_length=128)
    display_name = fields.CharField(max_length=100)
    # --- Aggregate gameplay statistics --- #
    total_games = fields.IntField(default=0)
    good_wins = fields.IntField(default=0)
    good_losses = fields.IntField(default=0)
    evil_wins = fields.IntField(default=0)
    evil_losses = fields.IntField(default=0)
    # Mapping role name -> {"wins": int, "losses": int}
    role_stats = fields.JSONField(default=dict)

    class Meta:
        table = "users" 