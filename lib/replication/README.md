# RESO Replication Client
The RESO Replication Client can be used to fetch data from a given URL using a number of different replication strategies and supports OAuth 2 bearer tokens and client credentials.

## View Help
Use the following command to view help info:

```
$ reso-certification-utils replicate --help

Usage: reso-certification-utils replicate [options]

Replicates data from a given resource with expansions.

Options:
  -s, --strategy <string>      One of TopAndSkip, ModificationTimestampAsc, ModificationTimestampDesc, or NextLink
  -u, --url <string>           The URL to start replicating from
  -b, --bearerToken <string>   Bearer token to use for authorization
  -p, --pathToConfigFile       Path to config containing credentials
  -r, --resourceName <string>  Resource name to replicate data from
  -x, --expansions <string>    Items to expand during the query process, e.g. Media
  -m, --metadataReportPath     Path to metadata report to use for replication
  -h, --help                   display help for command
```

## Example: Replicate Data from a URL Using `TopAndSkip`
Replicating from `https://some.api.com/Property` can be done as follows:
```
$ reso-certification-utils replicate -s TopAndSkip -u https://some.api.com/Property -b <your test token>
```
