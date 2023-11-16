[![Run Code Checks](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codecheck.yml/badge.svg)](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codecheck.yml) &nbsp; [![CodeQL](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codeql.yml/badge.svg)](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codeql.yml)

# RESO Certification Utils
NodeJS package with reference artifacts and ETL processes for Certification.

Can either be used from the command line or as a library.

## Command Line Usage
Clone repository into current directory:

```
// clone repo locally
$ git clone https://github.com/RESOStandards/reso-certification-utils
Cloning into 'reso-certification-utils'...
remote: Enumerating objects: 691, done.
remote: Counting objects: 100% (192/192), done.
remote: Compressing objects: 100% (127/127), done.
remote: Total 691 (delta 101), reused 97 (delta 65), pack-reused 499
Receiving objects: 100% (691/691), 436.98 KiB | 3.24 MiB/s, done.
Resolving deltas: 100% (320/320), done.

// change to source directory
$ cd reso-certification-utils

// install locally
$ npm i . 

// show help
$ reso-certification-utils --help

```

**Note**: _If you want to use a different directory besides the current one, please create and change to it before cloning (or pass it as an argument)._

## Library Usage

To install from GitHub:

```
npm i RESOStandards/reso-certification-utils
```

To install from Github via yarn:

add package `@reso/reso-certification-utils` and yarn install --check-files. After that build the docker container.

```
"@reso/reso-certification-utils": "https://github.com/RESOStandards/reso-certification-utils"
```

---

## RESO Certification
Runs one or more Data Dictionary tests using a provided configuration file.

[**MORE INFO**](./lib/certification/README.md)

## Restore Certification Server
Restores a RESO Certification API Server using a set of existing results in a given directory structure.

[**MORE INFO**](./lib/restore-utils/README.md)

## Find Variations
Uses a number of techniques to find potential variations for local items contained in a Data Dictionary metadata report.

[**MORE INFO**](./lib/variations/README.md)

## Schema Generation and Validation
Generates a schema from a metadata report and validates payload against a given schema.

[**MORE INFO**](./lib/schema/README.md)

## Replicate and Validate Data
CLI tools and Node libs to replicate data from a RESO Web API server using bearer tokens or OAuth2 Client Credentials.

[**MORE INFO**](./lib/replication/README.md)


## Tests

To run the tests, clone the repository:

```
git clone https://github.com/RESOStandards/reso-certification-utils.git
```

Then change into the directory and run:

```
npm i
```

Finally:

```
npm test
```

<br >

Questions? Contact [RESO Development](mailto:dev@reso.org).
