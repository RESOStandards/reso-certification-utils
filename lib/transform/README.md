## Run a transformation on all reports of a given cert API server
```bash
node index.js transform -u <server base url> -p <path to the directory where we want the reports backed up> -r -b -e
```

The `-b` or `--backup` flag creates a backup of all the DD/DA reports from the given server before starting the transformation.

The `-p` or `--pathToBackup` option is required when using the backup flag.

The `-r` or `--rescore` flag is a transformation that adjusts the EMPTY_LIST/NULL_VALUE counts, rescores the report, and posts them back to the cert API server.

The `-e` or `--runEtl` flag is another transformation that takes in a DA report, converts it to raw form, and runs the ETL method on the report. This transformation will always be run last if more than one transformation is provided.

__Note:__ It is advisable to always create a backup before running any transformations.

### Example usage

```bash
node index.js transform -u http://localhost -r -e -b -p ~/Documents
```