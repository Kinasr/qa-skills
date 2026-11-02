# Security

## Reporting a vulnerability

Please do not report security issues in a public issue. GitHub private vulnerability reporting must be enabled on the public repository; the maintainer enables it at release. If GitHub private vulnerability reporting is not available, contact the maintainer privately through the contact option on their GitHub profile.

Reports are welcome for vulnerabilities in the latest `0.2.x` release. There is no response time commitment and no SLA.

## Scope

Please report a Tester guard bypass, including one that could reach a non-production target, and unintended credential disclosure or insecure credential storage. Credential issues are in scope whether or not the affected file is git-ignored.

### Intentional auth storage

Some authentication data is intentionally stored to support configured access, including saved login states, password files, and files in `.qa/.auth/`, `auth/`, or a Run's authentication directory. An unintended disclosure or insecure handling of that data remains in scope.

The supported use is non-production targets with test accounts. The safeguards do not prevent permitted actions from changing application data, enforce a non-production target, or provide network-egress control. Origin checks run before explicit navigation and requests. They check navigation triggered by an action only after it happens, so they cannot prevent that navigation. Destructive-action limits are instructions, and `bypassPermissions` does not add a prompt boundary.
