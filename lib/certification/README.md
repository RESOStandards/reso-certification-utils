# RESO Certification
Runs RESO Certification testing tools for a given configuration. 

## Command Line Use
First, clone the RESO Commander into a local directory of your choosing:

```
$ git clone https://github.com/RESOStandards/web-api-commander.git
```

Create a `.env` file (if you don't have one already) and add `WEB_API_COMMANDER_PATH`, pointing to the path where you downloaded the Commander. 
See: [sample.env](../../sample.env) for an example.


Display available options for this command:
```
$ reso-certification-utils runDDTests --help
Usage: RESO Certification Utils runDDTests [options]

Runs Data Dictionary tests

Options:
  -p, --pathToConfigFile <string>  Path to config file
  -a, --runAllTests                Flag to run all tests
  -v, --version <string>           Data Dictionary version to use (default: "2.0")
  -l, --limit <int>                Number of records to sample per strategy, resource, and expansion (default: 100000)
  -S, --strictMode <boolean>       Use strict mode (default: true)
  -h, --help                       display help for command
```

**Notes**
* The `-p` argument is required. This will be the path to the JSON DD testing config. See [`sample-dd-config.json`](./sample-dd-config.json)
* The limit (`-l` or `--limit`) can be changed in pre-testing, but the default will be used for certification
* The tests are fast-fail, meaning that if the metadata tests don't succeed, data sampling won't be done since the output of the first step is required by others. Once the metadata tests pass, each subsequent test can be run individually

<br />

# Data Dictionary 1.7
For Data Dictionary 1.7, the following tests are run:
1. **Metadata Validation** (RESO Commander) - Includes type, synonym checking, and Lookup Resource validation
2. **Data Availability Report** (RESO Cert Utils) - Data Availability sampling using the [`replicate` option](../replication/README.md) and the TimestampDesc strategy

```sh
$ reso-certification-utils runDDTests -v 1.7 -p your-config.json -a
```

# Data Dictionary 2.0
For Data Dictionary 2.0, the following tests are run:
1. **Metadata Validation** (RESO Commander) - Includes type, synonym checking, and Lookup Resource validation
2. **Variations Report** (RESO Cert Utils) - Uses the [`findVariations` option](../variations/README.md) with the output of step (1)
  * Note: You will need a provider token in your `.env` file to access the Variations Service for mappings
  * Without a provider token, machine based techniques alone will be used 
  * Please contact [dev@reso.org](dev@reso.org) for more information
3. **Data Availability Report** (RESO Cert Utils) - Data Availability sampling using the [`replicate` option](../replication/README.md) and the following strategies:
  * TimestampDesc
  * NextLink
  * NextLink with ModificationTimestamp greater than 3 years ago
4. **Schema Validation** (RESO Cert Utils) - JSON Schema are generated from the output in step (1)
  * This is enabled by default since the `-S` or `--strictMode` flag is required for certification
  * Schema validation checks can be skipped by passing `-S false` or `--strictMode false`
  * This step is actually done in conjunction with step (3) but is listed for clarity
 

```sh
$ reso-certification-utils runDDTests -v 2.0 -p your-config.json -a
```

# Sampling

In all cases, up to 100,000 records per resource / strategy / expansion will be run for Certification.

This means that for Data Dictionary 2.0, if the Property Resource has a Media and OpenHouse expansion, sampling will be as follows:
* Property Resource with TimestampDesc
* Property + Media with TimestampDesc
* Property + OpenHouse with TimestampDesc
* Property Resource with NextLink
* Property + Media with NextLink
* Property + OpenHouse with NextLink
* Property Resource with NextLink and ModificationTimestamp greater than two years ago
* Property + Media with NextLink and ModificationTimestamp greater than two years ago
* Property + OpenHouse with NextLink and ModificationTimestamp greater two years ago

Records are deduplicated, but assuming 100,000 distinct Property records were fetched in each pass above, that would mean 900,000 records. for DD 1.7 there would be up to 300,000 unique Property records.

Records are hashed in memory, without anything being written to disk, for a large sample run this could still add up. It's roughly 32MB for 1M hashes.

## Sampling Parameters
There are parameters used internally that are designed to help with "polite behavior" so the client doesn't get rate limited, since waiting makes the process go slower. 

What seems to work best so far is a 1s delay between requests and a 60m delay if the client encounters an HTTP 429 status code. Please see the [`replicate` option](../replication/README.md) if that's something you're interested in experimenting with. 

# Report Files
When using the `runDDTests` option, a config file is required with both Unique Organization Id (UOI) and Unique System Id (USI) for the provider and UOI for the recipient. 

See: 
* [`sample-dd-config.json`](./sample-dd-config.json)
* [RESO UOI Google Sheet](https://docs.google.com/spreadsheets/d/13azRbctJ3V2yTibmFYLSfJZsdHc8v3r2NEgEmoHviRc/edit#gid=1039531884)

If each step is run individually, as outlined in the preceding sections, then the files are placed in the `results` directory. 

The directory structure is as follows:

```
- results
  - data-dictionary-<version>
    - <Provider UOI>-<Provider USI>
      - <Recipient UOI 1>
        - archived
          + 20231121T171951462Z
          + ...
        - current
          data-availability-report.json
          data-availability-responses.json
          data-dictionary-2.0.html
          data-dictionary-2.0.json
          data-dictionary-variations.json
          lookup-resource-lookup-metadata.json
          metadata-report.json
          metadata-report.processed.json
          metadata.xml
      + <Recipient UOI 2>
      + ...
    + ...
```

## Metadata Testing
The following files are related to metadata testing:

* `metadata.xml` - The OData XML Metadata downloaded from the provider
* `metadata-report.json` - Metadata in the RESO Field/Lookup format
* `lookup-resource-lookup-metadata.json` - When the Lookup Resource is used, this will contain the records that were downloaded
* `metadata-report.processed.json` - When the Lookup Resource is used, this file will contain the lookups merged into the main metadata report

There are also artifacts produced by Cucumber, `data-dictionary-2.0.html` and `data-dictionary-2.0.json`. The HTML file is useful for diagnosing metadata errors and can be opened in a local browser.

## Variations Report
Variations are contained within the `data-dictionary-variations.json` file. The format should be fairly self-explanatory in that each resource, field, or enumeration can have zero or more suggestions. 

This is similar to the Variations Report in the DD 2.0 Preflight Check.

## Sampling and Availability
There are two files related to sampling and availability:
* `data-availability-report.json` - Shows raw frequencies and stats for what was sampled
* `data-availability-responses.json` - Shows the requests that were run during testing

## Schema Validation Errors
If there are schema validation errors while sampling, the output will be in a file called `data-availability-schema-validation-errors.json`. In this case, there will be no data availability reports, as outlined above. 

The format of the schema validation reports can be [seen in the tests](../../test/schema/). These are generally grouped into categories with error messages and counts. 

Schema validation will also fail fast when used with Data Dictionary 2.0 testing, meaning that sampling will stop upon encountering a page of records that has validation errors. If you wish to run schema validation on its own, see the [`validate` action](../schema/README.md). 

This is also used for RESO Common Format testing.


# Questions?
If you have any questions, please contact [dev@reso.org](dev@reso.org).

You can also [open a ticket](https://github.com/RESOStandards/reso-certification-utils/issues). 