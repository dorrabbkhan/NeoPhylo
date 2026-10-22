At the very end of your output print exactly one line `PR_URL: <url>`. If a stop rule applies (a parity,
premise or budget failure; a missing dependency; an ambiguity you must not resolve yourself), do not
improvise: print a line starting with `STOP:` explaining why, and end. Show `git diff --stat` of your final
commit before the PR_URL line.
