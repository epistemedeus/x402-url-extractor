import os

# Importing main.py must not construct the production Agentverse app or
# contact the live catalog.
os.environ["AGENTVERSE_A2A_SKIP_PRODUCTION_APP"] = "1"
