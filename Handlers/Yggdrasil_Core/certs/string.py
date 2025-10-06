import argparse
import sys

def format_certificate_for_c(input_file_path):
    """
    Reads a PEM certificate file and converts it into a C-style
    multi-line string literal, printing the result to standard output.
    """
    try:
        with open(input_file_path, 'r') as f:
            lines = f.readlines()

        print(f"#ifndef CERT_H\n#define CERT_H\nconst char *SERVER_CERTIFICATE_PEM =")
        for line in lines:
            stripped_line = line.strip()
            if stripped_line:  # Process only non-empty lines
                print(f'"{stripped_line}\\n"')
        print(';\n#endif')

    except FileNotFoundError:
        print(f"Error: The file '{input_file_path}' was not found.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert a PEM certificate file into a C-style string literal."
    )
    parser.add_argument(
        "input_file",
        help="The path to the input certificate file (.pem)."
    )
    args = parser.parse_args()

    format_certificate_for_c(args.input_file)
