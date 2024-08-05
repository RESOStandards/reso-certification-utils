# RESO Universal Parcel Identifier (UPI) Validation
To validate RESO UPIs, use this utility from either the command line or call `runUpiTests` as a library method.


## Command Line Usage
To run from the command line, make sure that RESO Certification Utils is installed. See [README](/README.md).

```
$ reso-certification-utils runUpiTests --help

Usage: RESO Certification Utils runUpiTests [options]

Runs UPI Tests

Options:
  -p, --pathToResoCommonFormatJson <string>  Path to JSON samples in RESO Common Format
  -v, --version <string>                     Data Dictionary version to use (default: "2.0")
  -h, --help                                 display help for command

```

## Library Usage
For examples on how to run as a library, [see tests](/test/upi.js). 

## Output
If running from the CLI, the output will be written to a file in the root of the program directory called `upi-validation-report.json`. If running as a library, this file will be returned from the call to `runUpiTests`.

This file will either contain the number of validated records, if validation passed, or an error array with a list of UPIs with error messages indicating what the error was. 