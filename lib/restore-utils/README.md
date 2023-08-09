# Certification Server Restore Utilities
Restores a RESO Certification Server via its API using a local or S3 path.

Once the reso-certification-utils package is installed, usage will be shown by calling it with no arguments on the command line:

```
$ reso-certification-utils 
Usage: reso-certification-utils [options] [command]

Command line batch-testing and restore utils

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  restore [options]  Restores local or S3 results to a RESO Certification API instance
  help [command]     display help for command

```
---
<br />

## Restore Data Dictionary and Data Availability Results from a Local Path
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


## Sync Web API Core Results
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

## Restore from a server backup
```bash
reso-certification-utils  restore -u <server base url> -p <path to the server backup directory> --restoreFromBackup
```

The `--restoreFromBackup` or `-r` flag tells the tool to restore from the backed-up server data rather than raw reports.

### Example usage: 

```bash
reso-certification-utils  restore -u http://localhost -p ~/Downloads/reso-server-backup/data_dictionary-1.7 -r
```