# RESO Restore Utils

## Publish Results to a RESO Certification Server
Publishes certification results to a RESO Certification Server via its API using a local or S3 path.

Once the `reso-certification-utils` package is installed, usage will be shown by calling it with no arguments on the command line:

```
$ reso-certification-utils restore --help
Usage: RESO Certification Utils restore [options]

Restores local or S3 results to a RESO Certification API instance

Options:
  -p, --pathToResults <string>  Path to test results
  -u, --url <string>            URL of Certification API
  -h, --help                    display help for command
```
---
<br />

### Restore Data Dictionary and Data Availability Results from a Local Path
This option is used when there are Data Dictionary and Data Availability results to restore. 

The following directory structure is assumed:
```
- data_dictionary-1.7
  - providerUoi1-providerUsi1
    -recipientUoi1
      - current
        * <metadata report JSON>
        * <data availability report JSON>
      + archived
        + timestamp0001
        ...
  + providerUoiN-providerUsiN
``` 

If the required files don't exist for a given Organization, it will be skipped. 

Example:
    
```
reso-certification-utils restore -p <path/to/data-dictionary-results/parent-path> -u <server url> 
```

Where: 
* `-p` must point to the parent folder where the results directories reside
* `-u` may be any server URL, but there must be an API key for it in the .env file (see sample.env)

**Note**: If the given Data Dictionary results include data from the Lookup Resource, the lookup metadata will be merged with the Data Dictionary metadata when processed.


### Restore from a Server Backup
Restores previously backed-up reports to a RESO Certification Server. This mode skips org/system validation since the backed-up data is already known-good.

```
$ reso-certification-utils restore --help
Usage: RESO Certification Utils restore [options]

Restores local or S3 results to a RESO Certification API instance

Options:
  -p, --pathToResults <string>  Path to test results
  -u, --url <string>            URL of Certification API
  -r, --restoreFromBackup       Restore from a backup of a Cert API server
  -h, --help                    display help for command
```

Example:
```bash
reso-certification-utils restore -u http://localhost -p ~/Downloads/reso-server-backup/data_dictionary-1.7 -r
```

The `-r` / `--restoreFromBackup` flag tells the tool to restore from backed-up server data rather than raw reports.

The following directory structure is assumed (as produced by the `backup` command):
```
- data_dictionary-2.0
  - providerUoi1-providerUsi1
    - recipientUoi1
      * metadata-report.json
      * data-availability-report.json
    ...
  + providerUoiN-providerUsiN
```

Where:
* `-p` must point to the endorsement type directory inside the backup (e.g. `reso-server-backup/data_dictionary-2.0`)
* `-u` may be any server URL, but there must be an API key for it in the .env file (see sample.env)

---

### Sync Web API Core Results
TODO: Given a local path to Web API Core results, this option will ensure that any Data Dictionary Endorsements present on the server
with the same providerUoi and providerUsi combination also have their accompanying Web API Core results for a given provider.

The following directory structure is assumed:
```
- web_api_core-2.0.0
  - providerUoi1-providerUsi1
    * <web api core report JSON>
    ...
  + providerUoiN-providerUsiN
```

