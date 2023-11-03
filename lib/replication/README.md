# RESO Replication Client
The RESO Replication Client can be used to fetch data from a given URL using a number of different replication strategies and supports OAuth 2 bearer tokens and client credentials.

## View Help
Use the following command to view help info:

```
$ reso-certification-utils replicate --help
Usage: reso-certification-utils replicate [options]

Replicates data from a given resource with expansions.

Options:
  -s, --strategy <string>                  One of TopAndSkip, TimestampAsc, TimestampDesc, or NextLink
  -u, --serviceRootUri <string>            OData service root URI (no resource name or query)
  -b, --bearerToken <string>               Bearer token to use for authorization
  -c, --clientId <string>                  OAuth2 client_id parameter, use this OR bearerToken
  -i, --clientSecret <string>              OAuth2 client_secret parameter, use this OR bearerToken
  -k, --tokenUri <string>                  OAuth2 token_uri parameter, use this OR bearerToken
  -e, --scope <string>                     Optional OAuth2 scopes for client credentials
  -m, --pathToMetadataReportJson <string>  Path to metadata report JSON
  -r, --resourceName <string>              Resource name to replicate data from
  -x, --expansions <items>                 Comma-separated list of items to expand during the query process, e.g. Media,OpenHouse
  -f, --filter <string>                    OData $filter expression
  -t, --top <number>                       Optional parameter to use for OData $top
  -p, --maxPageSize <number>               Optional parameter for the odata.maxpagesize header
  -o, --outputPath <string>                Name of directory for results
  -l, --limit <number>                     Limit total number of records at client level
  -v, --version <string>                   Data Dictionary version to use (default: "2.0")
  -j, --jsonSchemaValidation <boolean>     Sets whether to use JSON schema validation (default: false)
  -h, --help                               display help for command
```

## Example: Replicate Data from a URL Using `TopAndSkip`
Replicating from `https://some.api.com/Property` can be done as follows:
```
$ reso-certification-utils replicate -s TopAndSkip -u https://some.api.com/Property -b <your test token>
```

## Example: Replicate Data from the Property Resource Using `NextLink` with a Media and OpenHouse Expansion
Replicating from `https://some.api.com/Property` can be done as follows:
```
$ reso-certification-utils replicate -s NextLink -u https://some.api.com/Property -b <your test token> -x Media,OpenHouse
```

You can also use the expand query directly, without the `-x` option. In that case, the dollar sign in `$expand` needs to be escaped.
```
$ reso-certification-utils replicate -s NextLink -u https://some.api.com/Property?\$expand=Media,OpenHouse -b <your test token>
```
Note the `\` before the `$expand`. Shells sometimes require escape sequences for special characters like `$`.
