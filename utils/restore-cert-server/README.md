# Certification Server Restore Utilities
Restores a RESO Certification Server via its API using a local or S3 path.

The following directory structure is assumed:
```
- providerUoi1
  - data-dictionary
    - 1.7
      - usi1
        - recipientUoi1
          - timestamp0001
            * <metadata report>
            * <data availability report>
          + timestamp0002
          + ...
          + timestamp000N
        + recipientUoi2
      + usi2
    + 2.0
  - web-api-server.core
    + 2.0.0
  - data-dictionary-idx
    - 1.7S
 + providerUoi2
  ...
 + providerUoiN
 ``` ---
 <br />

## Restore All Web API Core Endorsements from a Local or S3 Path
Restores all Web API Core Endorsements with those in an existing directory matching the standard structure above. In the initial release, the focus is on restoring from the local path with S3 support coming later.

Example:
    
```
restore --webApiCore --overwrite --<localPath|s3Path> <local or s3 root path>
```
Where: 
* `webApiCore` is endorsement type.
* `overwrite` (optional) specifies whether to replace existing results on the server with new ones.
* `localPath` is the path to the results. If empty or does not contain results, the program should have no side effects. `s3Path` will be used later on but is not supported currently.

Each directory will already have Web API Core results in this case, so just restore after checking results from the API, unless the optional `overwrite` flag is present, in which case the existing results will be replaced instead.

If `overwrite` is used, the user will be shown an  `Are you sure? (y/N)` confirmation defaulting to `N` with any other input exiting.

<br >

## Restore All Data Dictionary Endorsements from a Local or S3 Path
Restores all Data Dictionary and Data Dictionary + IDX Endorsements with those in an existing directory matching the standard structure above. 


Example:
    
```
restore --dd --overwrite --<localPath|s3Path> <local or s3 root path>
```
Where: 
* `dd` is endorsement type.
* `overwrite` (optional) specifies whether to replace existing results on the server with new ones.
* `localPath` is the path to the results. If empty or does not contain results, the program should have no side effects. `s3Path` will be used later on but is not supported currently.

There can be many versions for a set of Data Dictionary results in a given directory. For example, 1.7 and 2.0.  

In general, for each Data Dictionary version, the DD + IDX endorsement for that version should supercede all other DD endorsements. If the recipient attains a DD endorsement for a later version than the most recent DD + IDX endorsement version, then the later version of the DD should be used. 

This means for each recipent, both the Data Dictionary and Data Dictionary with IDX directories will need to be checked and whichever has the latest version should be used.

If `overwrite` is used, the user will be shown an  `Are you sure? (y/N)` confirmation defaulting to `N` with any other input exiting.

<br >

## Restore All Web API Core Endorsements from a New Web API Core Result
Another case is when a given set of recipients needs to be restored from a single Web API Core result. 

For M Recipients, the current requirement is that their Provider only needs to be tested on Web API Core once for all of their Recipients. This means we will need to be able to take a single Web API Core results file and create the standard directory structure, if it doesn't exist already, then restore from it.

```
restore --webApiCore --providerUoi <providerUoi> --providerUsi <providerUsi> --overwrite --pathToRecipientCSV --pathToWebApiCoreReport <path> --<localPath|s3Path>
```
Where:
* `providerUoi` is an M, P, T, or C UOI record validated against the current UOI data.
* `providerUsi` is a USI for the given provider also validated against current UOI data.
* `overwrite` (optional) specifies whether to replace existing results on the server with new ones.
* `pathToRecipientCSV` is a list of recipient UOIs to be restored for this provider UOI and USI. They should be validated against the UOI M, P, T, or C records to make sure each item exists and skip and then print a message with all items that were skipped. 
* `pathToWebApiCoreReport` specifies the path where the Web API Core results JSON file can be found. Both the version and timestamp of the report are in that file's header.
* `localPath` is the root of the folder that should contain the updated results. If that folder is empty, then running this command would create one folder per Web API Core result. If it already has results, it would copy the current directory to the old directory first and copy the new results to the `/current` directory for each recipient. This can be a local or S3 path, but for now will just be local.

Once the local directories are updated with the results, the restore all command outlined in the first item can be run to sync the results.
