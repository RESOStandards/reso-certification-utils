## Schema Generation and Validation

### Generate Schema

```bash
$ reso-certification-utils generate --help

Usage: reso-certification-utils generate [options]

Generate a schema from a given metadata report

Options:
  -m, --metadataPath <string>  Path to the metadata report JSON file
  -o, --outputPath <string>    Path tho the directory to store the generated schema
  -a, --additionalProperties   Pass this flag to allow additional properties in the schema
  -h, --help                   Display help for command
```

### Validate payload

```bash
$ reso-certification-utils validate --help

Usage: reso-certification-utils validate [options]

Validate one or more payloads against a schema

Options:
  -m, --metadataPath <string>  Path to the metadata report JSON file
  -p, --payloadPath <string>   Path to the payload that needs to be validated
  -s, --schemaPath <string>    Path to the generated JSON schema
  -e, --errorPath <string>     Path to save error reports in case of failed validation. Defaults to "./errors"
  -a, --additionalProperties   Pass this flag to allow additional properties in the schema
  -z, --zipFilePath <string>   Path to a zip file containing JSON payloads
  -dv, --version <string>      The data dictionary version of the metadata report. Defaults to 1.7
  -h, --help                   Display help for command
```

```bash
reso-certification-utils schema -g -m <path to metadata json file> -o <path to output directory>
```
Additional options:
- `-a` or `--additionalProperties`: Add this flag to allow additional properties.
- `-r` or `--resource`: Option to specify the resource. Defaults to `property`.

### Validate payload

```bash
reso-certification-utils schema -v -p <path to payloads json file> -s <path to the schema json file>
```
AJV errors could be large depending on how many errors are found. To save the errors in a file we can pass the directory where we want to save the errors file with `-e <path to error directory>`. By default they will be saved inside `./errors`.