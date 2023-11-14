# Find Variations
This tool uses a number of techniques to find variations between Data Dictionary metadata and the given file. 

To use, a Metadata Report is required. 

```
$ reso-certification-utils findVariations --help
Usage: reso-certification-utils findVariations [options]

Finds possible variations in metadata using a number of methods.

Options:
  -p, --pathToMetadataReportJson <string>  Path to metadata-report.json file
  -f, --fuzziness <float>                  Set fuzziness to something besides the default
  -v, --version <string>                   Data Dictionary version to compare to, i.e. 1.7 or 2.0
  -s, --useSuggestions <boolean>           Use external suggestions in addition to machine-provided ones (default: true)
  -c, --console <boolean>                  Show output to console (default: true)
  -h, --help                               display help for command
```

Note that if `useSuggestions` is true, the `.env` file MUST contain a provider token.

