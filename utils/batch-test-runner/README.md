# RESO Commander Batch Test Runner
Runs Commander testing tools for a given configuration. 

At the current time, only Data Dictionary and Data Availability testing is supported. 

## Command Line Use
First, clone the RESO Commander into a local directory of your choosing:

```
$ git clone https://github.com/RESOStandards/web-api-commander.git
```

Create a `.env` file (if you don't have one already) and add `WEB_API_COMMANDER_PATH`, pointing to the path where you downloaded the Commander. 
See: [sample.env](../../sample.env) for an example.


Display available options for this command:
```
$ reso-certification-utils help runDDTests
Usage: reso-certification-utils runDDTests [options]

Runs Data Dictionary tests

Options:
  -p, --pathToConfigFile <string>  Path to config file
  -a, --runAvailability            Flag to run data availability tests, otherwise only metadata tests are
                                   run
  -h, --help                       display help for command
```

The `-p` argument is required. This will be the path to the JSON DD testing config. See [`sample-dd-config.json`](./sample-dd-config.json).


**TODO**
* Rather than taking a path to the Commander, copy the Commander repo to a local temp directory
* Rather than taking a path to the Commander, take a URL to a Docker container instead and run tests in that container
* Add hooks to restore utils with an option to restore results when passed or failed
* Add backup to S3
