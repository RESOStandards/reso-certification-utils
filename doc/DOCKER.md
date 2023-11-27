# Docker
RESO Certification Utils can be used in a Docker container. 

**Note**: There's currently an issue with ARM 64 platforms and Gradle/Docker. As such, Docker won't work on Apple Silicon. Please install locally instead. [See: README](/README.md).

## Docker Installation

To build a Docker container, first [install Docker](https://docs.docker.com/get-docker/). 

Make sure it's running: 

```
$ docker ps -a
```

If Docker is running, you should see information about any containers on your system. 

If you receive a message similar to the following, then Docker is not running: 

```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
```

## Cloning Repository
Make sure [Git is installed](https://github.com/git-guides/install-git) using the following command in the terminal:

```
$ git --version
```

If it's not installed, you'll see some kind of error. 

Otherwise, clone the repository: 

```
$ git clone https://github.com/RESOStandards/reso-certification-utils
Cloning into 'reso-certification-utils'...
remote: Enumerating objects: 691, done.
remote: Counting objects: 100% (192/192), done.
remote: Compressing objects: 100% (127/127), done.
remote: Total 691 (delta 101), reused 97 (delta 65), pack-reused 499
Receiving objects: 100% (691/691), 436.98 KiB | 3.24 MiB/s, done.
Resolving deltas: 100% (320/320), done.
```


Then change to the source directory:
```
$ cd reso-certification-utils
```

## Building Docker Container
To build the Docker container, use the following command:

```
$ docker build -t reso-certification-utils --no-cache .
```

Once the container has been built, it should show up in the list of available containers: 

```
$ docker images
REPOSITORY                                          TAG                      IMAGE ID       CREATED             SIZE
reso-certification-utils                            latest                   262038261764   About an hour ago   1.06GB
...
```

If there are any errors building the container, try repeating the process.


# Running `reso-certification-utils`
The entrypoint of the Docker container is the `reso-certification-utils` application, so you can use it for any of the commands in the [README](/README.md).

```
$ docker run -it reso-certification-utils --help
Usage: RESO Certification Utils [options] [command]

Command line batch-testing and restore utils

Options:
  -V, --version             output the version number
  -h, --help                display help for command

Commands:
  schema [options]          Generate a schema or validate a payload against a schema
  restore [options]         Restores local or S3 results to a RESO Certification API instance
  runDDTests [options]      Runs Data Dictionary tests
  findVariations [options]  Finds possible variations in metadata using a number of methods.
  replicate [options]       Replicates data from a given resource with expansions.
  metadata [options]        Converts metadata from OData XML to RESO Format.
  help [command]            display help for command

```

Depending on the task, you will also need to mount the appropriate volumes in the Docker container. 

## RESO Certification

## Data Dictionary Testing
To run the Data Dictionary tests, use the following command once the container has been built: 

```
$ docker run -v ./results:/results -v ./config.json:/config.json -it reso-certification-utils runDDTests -v 1.7 -p /config.json -l 200 -a 
```

Where: 

* `-v ./results:/results` mounts the local results directory to the container, and will create the local directory if it doesn't exist
* `-v ./config.json:/config.json` mounts a config file in the current directory to the Docker container. See: [sample config](../lib/certification/sample-dd-config.json)
* `-it` tells Docker to use an interactive terminal
* `reso-certification-utils` is the name of the container to run
* `-v 1.7` uses Data Dictionary 1.7 tests and references
* `-p /config.json` is the path to the config file within the container
* `-l 200` sets the limit to 200 records per resource / expansion / strategy (default: 100,000)
* `-a` is the option to run all tests - without it, only metadata tests are run

Results will be outputted in a directory called `results`.

### Variations Service

In order to use the Variations Service, the Data Dictionary 2.0 tests will need an environment variable with a token. 

This can either be passed as an environment variable: 

```
$ docker run -v ./results:/results -v ./config.json:/config.json -it -e <provider token> reso-certification-utils runDDTests -v 2.0 -p /config.json -l 200 -a 
```

Or you can use an environment file (preferred): 

```
$ docker run -v ./results:/results -v ./config.json:/config.json -it --env-file .env reso-certification-utils runDDTests -v 2.0 -p /config.json -l 200 -a 
```

Where `.env` file would be a file in the current directory containing a variable called `PROVIDER_TOKEN` with a value. See [`sample.env`](../sample.env) for more information.

To obtain a provider token, contact [dev@reso.org](mailto:dev@reso.org).

If no provider token is specified, then only machine-based matching techniques will be used.


## Other Tasks
See the [RESO Certification](#reso-certification) example for how to mount files and directories. 
