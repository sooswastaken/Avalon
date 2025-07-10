GOOD_ROLES = {"Merlin", "Percival", "Loyal Servant of Arthur"}
EVIL_ROLES = {"Mordred", "Morgana", "Oberon", "Minion of Mordred"}

# Required team sizes per quest round for each total player count.
# Index 0-4 correspond to quests 1-5 respectively.
QUEST_SIZES: dict[int, list[int]] = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
}

__all__ = [
    "GOOD_ROLES",
    "EVIL_ROLES",
    "QUEST_SIZES",
] 