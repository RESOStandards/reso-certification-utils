[![Run Code Checks](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codecheck.yml/badge.svg)](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codecheck.yml) &nbsp; [![CodeQL](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/RESOStandards/reso-certification-utils/actions/workflows/codeql-analysis.yml)

# RESO Certification Utils
NodeJS package with reference artifacts and ETL processes for Certification.

To install from GitHub:

```
npm i RESOStandards/reso-certification-utils
```

To install from Github via yarn:

add package `@reso/reso-certification-utils` and yarn install --check-files. After that build the docker container.

```
"@reso/reso-certification-utils": "https://github.com/RESOStandards/reso-certification-utils"
```

## Batch Test Runner
Runs a batch of tests using a provided configuration file.

[MORE INFO](./utils/batch-test-runner/README.md)

## Restore Certification Server
Restores a RESO Certification API Server using a set of existing results in a given directory structure.

[MORE INFO](./utils/restore-cert-server/README.md)

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
