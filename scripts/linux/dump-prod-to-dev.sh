#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Set paths (update these if needed)
PROD_CONFIG="/home/aron/IdeaProjects/chungus-battles-backend/config.prod.yaml"
DEV_CONFIG="/home/aron/IdeaProjects/chungus-battles-backend/config.dev.yaml"

# Dump and restore 'talents' collection
mongodump --config="$PROD_CONFIG" --collection=talents
mongorestore --config="$DEV_CONFIG" --drop --collection=talents dump/chungus/talents.bson

# Dump and restore 'items' collection
mongodump --config="$PROD_CONFIG" --collection=items
mongorestore --config="$DEV_CONFIG" --drop --collection=items dump/chungus/items.bson

# Optional: Wait for keypress (uncommon on Linux)
read -p "Press any key to continue..."
