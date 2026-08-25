# Find Variations
This tool uses a number of techniques to find variations between Data Dictionary metadata and the given file. 

To use, a Metadata Report is required. 

```
$ reso-certification-utils findVariations --help
Usage: RESO Certification Utils findVariations [options]

Finds possible variations in metadata using a number of methods

Options:
  -p, --pathToMetadataReportJson <string>  Path to metadata-report.json file
  -f, --fuzziness <float>                  Set fuzziness to something besides the default (default: 0.25)
  -v, --version <string>                   Data Dictionary version to compare to, i.e. 1.7 or 2.0 (default: "2.0")
  -s, --useSuggestions <boolean>           Use external suggestions in addition to machine-provided ones (default: true)
  -h, --help                               display help for command
```

Note that if `useSuggestions` is true, the `.env` file must contain auth information for the
Variations Service. Two schemes are accepted: the current **OAuth2 client credentials**
(`TOKEN_URI`, `CLIENT_ID`, `CLIENT_SECRET`, plus `RESO_SERVICES_URL`) — the format the
Certification site prefills into the downloadable `.env` — or the legacy **ApiKey** scheme
(`CERT_AUTH_API_BASE_URL`, `CERT_AUTH_API_USERNAME`, `CURRENT_PROVIDER_UOI`,
`CERTIFICATION_API_KEY`) as a fallback. See [sample.env](../../sample.env) for more information.

When running `findVariations` on its own, point `-p` at the **merged** metadata report — the
`metadata-report.processed.json` produced by `runDDTests`, which includes the Lookup Resource
values. Using the base `metadata-report.json` will return no Lookup suggestions.

For information on how to obtain auth info, please contact [dev@reso.org](mailto:dev@reso.org).

# Update Variations (Admin)
There's also an admin function to update variations, but this isn't available for normal users. 

```
$ reso-certification-utils updateVariations --help
Usage: RESO Certification Utils updateVariations [options]

(Admin) Updates suggestions in the Variations Service

Options:
  -p, --pathToCsvSuggestions <string>  Suggestions CSV file name
  -h, --help                           display help for command
```

The CSV file in this case would have a structure similar to that being used in the RESO Fast Track Subgroup. 