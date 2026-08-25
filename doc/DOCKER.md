# Docker

RESO Certification Utils can run in a Docker container. The image builds and runs on both Apple Silicon (ARM64) and x86_64, so Docker is the simplest way to run the tools without installing a local Node or Java toolchain.

## Installing Docker

First, **[install Docker](https://docs.docker.com/get-docker/)**. Confirm it is running:

```
$ docker ps -a
```

If Docker is running, you will see the containers on your system. If it is not running, you will see a message similar to:

```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
```

## Cloning the Repository

Confirm **[Git is installed](https://github.com/git-guides/install-git)**:

```
$ git --version
```

Then clone the repository and change into it:

```
$ git clone https://github.com/RESOStandards/reso-certification-utils
$ cd reso-certification-utils
```

## Building the Image

Build the image. The build clones the RESO Commander and the RESO Certification Utils source inside the container, so no local toolchain is required:

```
$ docker build -t reso-certification-utils --no-cache .
```

`--no-cache` makes the build pull the latest source rather than reuse a cached clone. Once built, the image appears in the image list:

```
$ docker images
REPOSITORY                 TAG      IMAGE ID       CREATED         SIZE
reso-certification-utils   latest   262038261764   2 minutes ago   1.3GB
```

If the build fails, run it again.

## Running `reso-certification-utils`

The container entrypoint is the `reso-certification-utils` application, so any command from the **[README](/README.md)** works:

```
$ docker run --rm reso-certification-utils --help
```

Depending on the task, mount the volumes the command needs (a config file, an output directory) and pass credentials with `--env-file`.

## Data Dictionary Testing

Run the Data Dictionary tests with `runDDTests`:

```
$ docker run --rm \
  -v ./config.json:/config.json:ro \
  -v ./results:/reso-certification-utils/results \
  --env-file ./.env \
  reso-certification-utils \
  runDDTests -v 2.0 -p /config.json -a
```

Where:

* `-v ./config.json:/config.json:ro` mounts the config file read-only. See the **[sample config](../lib/certification/sample-dd-config.json)**.
* `-v ./results:/reso-certification-utils/results` mounts a local `results` directory to the path the tool writes to. The container working directory is `/reso-certification-utils`, so results land in `/reso-certification-utils/results`, not `/results`. The local directory is created if it does not exist.
* `--env-file ./.env` passes the credentials the run needs (see **Credentials** below).
* `runDDTests` runs the tests, `-v 2.0` selects the Data Dictionary version (`1.7` is also available), `-p /config.json` is the in-container config path and `-a` runs all tests. Without `-a`, only the metadata tests run.
* `-l <n>` sets the sample limit per resource, expansion and strategy (default 100,000). Add it (e.g., `-l 200`) for a lighter pretest run.

Results are written to the mounted `results` directory.

## Credentials

Pass credentials with an environment file (`--env-file`) rather than on the command line, so they stay out of your shell history. The Data Dictionary 2.0 Variations Service step needs Cert API credentials in that file. Two schemes are accepted:

* **OAuth2 client credentials** – the format the Certification site prefills into the `.env` you download: `TOKEN_URI`, `CLIENT_ID`, `CLIENT_SECRET`, plus `RESO_SERVICES_URL`.
* **Legacy ApiKey** – `CERT_AUTH_API_BASE_URL`, `CERT_AUTH_API_USERNAME`, `CURRENT_PROVIDER_UOI`, `CERTIFICATION_API_KEY`, plus `RESO_SERVICES_URL`.

See **[`sample.env`](../sample.env)** for the full list, and contact **[dev@reso.org](mailto:dev@reso.org)** for the values. Without them, only machine matching runs, which is still enough to start Data Dictionary 2.0 testing.

Do not set `WEB_API_COMMANDER_PATH` in the environment file. The image ships its own Commander and sets that path; overriding it points the container at a path that does not exist.

## Finding Variations Directly

`findVariations` runs the variations check against a metadata report on its own:

```
$ docker run --rm \
  -v ./metadata-report.processed.json:/metadata-report.json:ro \
  --env-file ./.env \
  reso-certification-utils \
  findVariations -p /metadata-report.json -v 2.0
```

Two things to know:

* Feed the **merged** report, `metadata-report.processed.json` (produced by `runDDTests`), not the base `metadata-report.json`. The merged report carries the Lookup Resource values the service matches against. The base report returns no Lookup suggestions.
* `findVariations` writes `data-dictionary-variations.json` to its working directory (`/reso-certification-utils` in the container). To keep the file, run without `--rm` and copy it out with `docker cp`, or run the variations step through `runDDTests`, which writes to the mounted `results` directory.

## Other Tasks

The other commands (`schema`, `replicate`, `metadata` and `restore`) follow the same pattern: mount the files the command reads and writes, and pass any credentials with `--env-file`. Run `docker run --rm reso-certification-utils <command> --help` for each command's options.
