# RESO Backup Utils

## Back Up Reports from a RESO Certification Server
Downloads certification reports from a RESO Certification API server and saves them to a local directory.

```
$ reso-certification-utils backup --help
Usage: RESO Certification Utils backup [options]

Backs up reports from a RESO Certification API server

Options:
  -u, --url <string>            URL of Certification API
  -p, --pathToBackup <string>   Path to store the backup
  -d, --dataDictionary          Only backup DD and DA reports
  -w, --webApi                  Only backup Web API reports
  -s, --skip <number>           Skip first n reports
  -h, --help                    display help for command
```

### Prerequisites
The following environment variables must be set in your `.env` file (see `sample.env`):
* `CERTIFICATION_API_KEY` — API key for the Certification server
* `ENDORSEMENTS_PATH` — path to the endorsements filter endpoint on the Cert API

### Back Up Everything
```bash
reso-certification-utils backup -u http://localhost -p ~/backups
```

This will back up all Data Dictionary, Data Availability, and Web API Server Core reports to:
```
~/backups/reso-server-backup/
```

### Back Up Data Dictionary Only
```bash
reso-certification-utils backup -u http://localhost -p ~/backups -d
```

### Back Up Web API Only
```bash
reso-certification-utils backup -u http://localhost -p ~/backups -w
```

### Skip Reports
Use `-s` to skip the first N reports (useful for resuming an interrupted backup):
```bash
reso-certification-utils backup -u http://localhost -p ~/backups -s 50
```

### Output Directory Structure
Reports are saved in the following structure:
```
reso-server-backup/
  - data_dictionary-2.0/
    - providerUoi1-providerUsi1/
      - recipientUoi1/
        * metadata-report.json
      - recipientUoi2/
        * metadata-report.json
    + providerUoiN-providerUsiN/
  - data_availability-2.0/
    - providerUoi1-providerUsi1/
      - recipientUoi1/
        * data-availability-report.json
    ...
  - web-api-core-report.json-2.0.0/
    - providerUoi1-providerUsi1/
      - recipientUoi1/
        * web-api-core-report.json
    ...
```

This output can be used directly with the `restore --restoreFromBackup` command.
