## Backup a Reso Cert API server
```bash
node index.js backup -u <server base url> -p <path to the directory where we want the reports backed up> -d -w
```

`-d` and`-w` are optional flags that specify whether to 'only backup DD/DA reports (`-d`)' or to 'only backup webAPI reports (`-w`)'. Omitting/Including both will back up everything.

### Example usage:

```bash
reso-certification-utils backup -u http://localhost -p ~/Downloads
```