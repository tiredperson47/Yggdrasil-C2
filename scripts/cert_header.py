import argparse
import sys

def format_certificate_for_c(mode, input_file_path):
    """
    Reads a PEM certificate file and converts it into a C-style
    multi-line string literal, printing the result to standard output.
    """
    file_type = mode.lower()
    match file_type:
        case "server":
            variable = "SERVER_CERTIFICATE"
        case "client_cert":
            variable = "CLIENT_CERT"
        case "client_key":
            variable = "CLIENT_KEY"
        case _:
            print(f'ERROR: Invalid mode type {file_type}')
            sys.exit(1)


    try:
        with open(input_file_path, 'r') as f:
            lines = f.readlines()

        print(f"#ifndef CERT_H\n#define CERT_H\nconst char *{variable} =")
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
        description="Convert a certificate file into a C-style string literal."
    )
    parser.add_argument("-m", "--mode", required=True, type=str, help="Type of certificate to format (Options: Server, Client_Cert, Client_Key)")
    parser.add_argument("input_file", type=str, help="The path to the input certificate file")
    args = parser.parse_args()

    format_certificate_for_c(args.mode, args.input_file)
