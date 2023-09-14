## Schema Generation and Validation

```bash
$ reso-certification-utils schema --help

Usage: reso-certification-utils schema [options]

Generate a schema or validate a payload against a schema

Options:
  -g, --generate               Generate JSON schema from a metadata report
  -v, --validate               Validate a payload against a generated schema
  -m, --metadataPath <string>  Path to the metadata report JSON file
  -o, --outputPath <string>    Path tho the directory to store the generated schema
  -p, --payloadPath <string>   Path to the payload that needs to be validated
  -s, --schemaPath <string>    Path to the generated JSON schema
  -e, --errorPath <string>     Path to save error reports in case of failed validation. Defaults to "./errors"
  -a, --additionalProperties   Pass this flag to allow additional properties in the schema
  -z, --zipFilePath <string>   Path to a zip file containing JSON payloads
  -h, --help                   display help for command
```

### Generate schema

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