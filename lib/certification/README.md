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
$reso-certification-utils runDDTests --help

Usage: RESO Certification Utils runDDTests [options]

Runs Data Dictionary tests

Options:
  -p, --pathToConfigFile <string>  Path to config file
  -a, --runAllTests <boolean>      Flag to run all tests (default: false)
  -v, --version <string>           Data Dictionary version to use (default: "1.7")
  -h, --help                       display help for command
```

The `-p` argument is required. This will be the path to the JSON DD testing config. See [`sample-dd-config.json`](./sample-dd-config.json).
