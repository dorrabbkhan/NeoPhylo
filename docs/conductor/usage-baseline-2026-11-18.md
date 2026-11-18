# Conductor usage baseline — 2026-11-18

Baseline for the conductor-efficiency plan (Tasks 0a/0b) — "before" numbers for the
target "v1.4d tasks median ≤ $1.50/task; first-turn input ≤ 21k". Measured by the
conductor on 2026-11-18 with Epiora's `usage-report.ts` pointed at
`~/.claude/projects/-home-dorrabb-NeoPhylo` (`--since 2026-10-15`; Opus/Sonnet/Haiku
priced 4/20/0.20/8, 2/10/0.10/4, 0.10/0.50/0.01/0.20 per 1M tokens). Aggregates only —
copied verbatim from `.conductor-ref/usage-baseline.txt`; the JSON twin is
`.conductor-ref/usage-baseline.json` (untracked reference material, not committed).

**Attribution caveat (E6):** this run used Epiora's attribution rules
(`devin.sh|build-prompt.sh <kind> <v> <N>` and `epiora-conductor/<v>-task<N>` paths).
The Task-0a `usage-report.ts` attributes by `devin.sh`/`build-prompt.sh` calls and
`neophylo-conductor/<v>-task<N>` paths, so the task columns of a re-run may differ —
sessions logged under `~/neophylo-conductor/…` (e.g. most v1.4b/v1.4c work, today part
of `unattributed`) should land in per-task rows.

Key totals (summary table below): 75 sessions, 5,087 turns, **$314.77** API-equivalent
($306.74 Opus). Per-task medians: v1.3 $3.50, v1.4 $2.36; max $21.73 (v1.3 Task 12,
383 turns). First-turn context median 48.4k; mean-context median 103.8k.

```text
usage report · projects /home/dorrabb/.claude/projects/-home-dorrabb-NeoPhylo · 75 session(s) · since 2026-10-15 · version all

sessions
session  task             turns        $ ctx-first  ctx-mean  tool mix
0269dbbc unattributed         3    0.209     47.7k     49.7k  bash:2 devin:1
0383eef5 v1.3-task3          52    2.328     47.6k     90.9k  bash:24 diff-read:10 grep:5 file-read:5 Write:4
0540a7ce v1.4-task12        196   16.127     61.3k    224.7k  bash:80 diff-read:48 file-read:14 ci-wait:14 devin:10
057da236 unattributed        94    6.155     51.5k    118.7k  bash:52 grep:12 WebSearch:9 Write:4 ToolSearch:3
05b9795d unattributed        87    5.226     64.6k    127.9k  bash:39 diff-read:14 devin:12 ci-wait:9 file-read:5
0847fa2a v1.3-task12        276   15.554     46.2k    132.6k  bash:135 diff-read:47 file-read:27 devin:21 ci-wait:18
098d31c4 unattributed        64    3.192     46.8k    114.6k  bash:33 diff-read:6 devin:5 grep:5 mcp__t3-code__t3_background_wait:4
0e613433 v1.4-task4          37    1.744     47.0k     87.3k  bash:16 devin:7 diff-read:7 ci-wait:3 grep:1
0f0cc138 unattributed        76    3.715     46.7k    112.8k  bash:30 mcp__t3-code__t3_background_wait:14 diff-read:10 devin:8 ci-wait:6
105f8d0a v1.4-task8          37    1.729     60.0k     94.1k  bash:15 diff-read:9 devin:7 file-read:5 ci-wait:3
131a0234 unattributed        50    2.290     46.6k     96.9k  bash:25 diff-read:7 devin:5 grep:3 mcp__t3-code__t3_background_wait:3
1332d3c3 unattributed       316   20.540     46.9k    160.8k  bash:169 mcp__t3-code__t3_background_wait:39 diff-read:32 devin:16 ci-wait:16
175c96b4 unattributed        74    5.066     49.1k    125.7k  bash:36 diff-read:13 file-read:7 devin:5 mcp__t3-code__t3_background_wait:5
1c1054b5 unattributed        37    1.817     46.6k     89.3k  bash:12 devin:7 diff-read:6 grep:3 mcp__t3-code__t3_background_wait:3
1d1741d5 v1.3-task5          75    4.008     60.4k    130.8k  bash:24 diff-read:23 file-read:8 ci-wait:7 devin:6
1fe62ed1 unattributed         3    0.204     61.0k     61.9k  bash:1 grep:1
206619d8 unattributed         1    0.089     23.6k     23.6k  
207b7837 v1.3-task9          43    1.696     47.8k     79.7k  bash:14 diff-read:10 file-read:10 devin:5 grep:3
2194b9ce v1.4-task2          91    6.150     46.4k    135.9k  bash:39 diff-read:16 devin:13 mcp__t3-code__t3_background_wait:8 grep:3
2b523b6c unattributed         1    0.065     39.0k     39.0k  
2b76aec4 v1.3-task8          53    2.418     60.6k    104.3k  bash:14 diff-read:12 devin:10 file-read:10 ci-wait:5
2b9fcf69 unattributed        58    3.267     66.4k    129.3k  bash:28 diff-read:8 grep:6 file-read:6 devin:5
2ba647e3 unattributed        56    3.991     64.5k    112.6k  bash:25 diff-read:12 devin:5 grep:2 ci-wait:2
2f3b1f18 v1.4-task13        106    5.374     61.5k    142.2k  bash:45 diff-read:16 ci-wait:12 devin:8 file-read:5
35cde885 unattributed        53    2.438     48.4k     96.6k  bash:20 diff-read:12 file-read:11 devin:6 ci-wait:4
377686b0 unattributed        55    3.424     66.4k    124.7k  bash:32 devin:6 diff-read:5 file-read:4 grep:2
4045b142 unattributed        18    0.887     64.6k     84.9k  bash:10 devin:5 diff-read:3
43654d2c v1.3-task7          39    1.615     60.6k     91.2k  bash:17 devin:8 file-read:6 diff-read:5 grep:3
48a3eb51 unattributed         4    0.184     19.5k     25.9k  diff-read:3 bash:1
4d76e12e unattributed         1    0.116     20.8k     20.8k  
4f2a1f52 v1.3-task4         127    7.250     47.6k    101.8k  bash:69 file-read:25 diff-read:15 ci-wait:11 devin:9
5144913a v1.4-task7          43    2.330     47.1k    103.5k  bash:18 devin:9 diff-read:9 grep:3 ci-wait:2
525f5e8c unattributed        32    1.682     48.9k     78.6k  bash:12 file-read:8 diff-read:4 devin:3 PushNotification:2
538b9d26 unattributed       122    7.210     47.1k    127.1k  bash:49 file-read:24 diff-read:16 devin:14 ci-wait:14
5fa3e5ff unattributed       230    8.019     66.3k    204.6k  bash:43 grep:32 file-read:31 mcp__Claude_Browser__javascript_tool:24 mcp__Claude_Browser__read_page:21
68ccfafd unattributed       129   12.583     52.3k    141.8k  bash:69 WebSearch:46 grep:9 WebFetch:7 Write:6
699720fc v1.4-task10        113   10.804     64.8k    149.1k  bash:35 diff-read:25 file-read:14 grep:13 devin:10
6e27b5a9 unattributed        95    6.891     66.1k    164.4k  bash:42 file-read:20 diff-read:17 devin:9 grep:9
785c193b v1.4-task3          33    1.393     46.9k     79.7k  bash:14 devin:6 diff-read:6 ci-wait:4
78a193fb unattributed         1    0.175     47.3k     47.3k  bash:1
7ab084cd unattributed        22    0.994     67.6k     86.0k  bash:12 diff-read:4 devin:2 ToolSearch:1 ci-wait:1
7ff5f2d4 unattributed         1    0.140     64.2k     64.2k  devin:1
8248ae76 unattributed       124    6.908     68.5k    151.5k  bash:63 diff-read:16 devin:14 ci-wait:14 file-read:11
850e30a3 unattributed        81    5.058     66.4k    118.7k  bash:42 diff-read:13 ci-wait:8 devin:5 file-read:5
86a2dc0c v1.3-task1           7    0.198     23.6k     32.0k  bash:5 devin:3 Write:1
89400f35 unattributed        53    3.190     48.4k    104.7k  bash:25 file-read:9 devin:7 diff-read:7 grep:2
91bf537f v1.4-task9         139   10.864     60.0k    180.6k  bash:49 diff-read:40 file-read:26 grep:7 devin:6
943d8acb unattributed        35    1.670     65.3k     99.6k  bash:19 devin:5 file-read:4 Write:3 diff-read:3
94672f8c v1.4-task13        142   11.718     62.0k    167.1k  bash:67 diff-read:16 devin:14 ci-wait:11 grep:4
94fc7399 v1.4-task5          30    1.490     59.9k     90.8k  bash:14 devin:6 diff-read:5 grep:2 ci-wait:1
9672e891 v1.3-task11         53    3.060     46.7k     94.0k  bash:20 devin:8 diff-read:7 file-read:7 ci-wait:5
97ec73dc unattributed        53    2.620     63.4k    112.0k  bash:21 diff-read:14 devin:5 grep:4 Write:3
9dccc83d unattributed        19    0.960     65.9k     84.2k  bash:10 diff-read:3 file-read:3 devin:2 ci-wait:1
9f387017 unattributed        21    1.016     68.2k     88.0k  bash:11 devin:4 grep:3 diff-read:1
a0a5034f unattributed        91    5.280     64.6k    145.3k  bash:48 devin:11 diff-read:11 grep:6 ci-wait:4
ab1186f3 unattributed        50    2.632     47.1k    107.5k  bash:23 devin:6 mcp__t3-code__t3_background_wait:6 diff-read:6 grep:4
b06d8510 v1.3-task2         142   12.967     67.1k    212.4k  bash:73 devin:17 diff-read:15 file-read:7 grep:5
b277ab8c unattributed         3    0.204     48.6k     49.1k  bash:3
b3c9cb68 unattributed        46    2.292     49.1k     92.5k  bash:31 diff-read:4 ci-wait:2 devin:2 Write:1
c19d4d06 v1.4-task6          44    2.386     47.0k    104.7k  bash:25 devin:6 grep:6 diff-read:5 ci-wait:2
c39a1204 unattributed       110    5.995     46.6k    131.8k  bash:37 mcp__t3-code__t3_background_wait:19 diff-read:15 grep:14 devin:12
c437c708 unattributed        59    3.469     63.4k    102.8k  bash:31 diff-read:8 devin:7 ci-wait:5 ScheduleWakeup:3
c8b8b0b0 v1.4-task2          43    2.821     46.9k     96.3k  bash:14 diff-read:12 devin:6 ci-wait:5 grep:1
d1c92c45 v1.3-task1          43    2.378     44.7k    109.3k  devin:17 bash:16 diff-read:3 ci-wait:2
d29aa182 v1.3-task6          53    2.366     60.6k    103.0k  diff-read:19 bash:17 devin:8 file-read:5 ci-wait:3
d65acb80 v1.4-task1          14    0.487     46.7k     54.7k  diff-read:4 bash:4 devin:4 ci-wait:1
d7bd821e unattributed        67    4.433     47.1k    125.0k  bash:25 file-read:12 diff-read:10 mcp__t3-code__t3_background_wait:7 devin:6
d9f90758 v1.3-task1          97    6.510     44.7k    159.2k  bash:41 devin:35 diff-read:10 ci-wait:5 ToolSearch:1
df3a8613 v1.3-task10         64    3.930     47.8k    103.8k  bash:23 file-read:13 diff-read:11 devin:10 ci-wait:4
e36513c1 unattributed         1    0.177     46.1k     46.1k  
eac5a629 unattributed         6    0.497     46.5k     60.1k  bash:3 WebSearch:2 ToolSearch:1
ee9bbc33 unattributed         2    0.149     25.1k     27.0k  bash:2
f7f2c7fb unattributed       224   16.293     46.0k    181.1k  bash:148 Edit:24 grep:16 mcp__t3-code__t3_background_wait:16 Write:13
f92d7cf5 v1.3-task12        107    6.174     46.8k    145.2k  bash:47 file-read:28 devin:14 ci-wait:11 diff-read:9
fac5dbbd unattributed        60    3.486     46.4k    111.8k  bash:23 diff-read:10 devin:9 mcp__t3-code__t3_background_wait:6 grep:3

per task (all models)
task               sess  turns   input  cache-rd  cache-wr   output        $    ctx1~    ctxμ~  tool mix
unattributed         46   2788    6.2k   373.43M     8.36M    1.69M  166.899    48.7k   103.8k  bash:1308 diff-read:304 devin:219 file-read:209 grep:159
v1.3-task1            3    147     340    19.87M    495.0k    57.6k    9.086    44.7k   109.3k  bash:62 devin:55 diff-read:13 ci-wait:7 Write:1
v1.3-task10           1     64     140     6.40M    243.3k    35.2k    3.930    47.8k   103.8k  bash:23 file-read:13 diff-read:11 devin:10 ci-wait:4
v1.3-task11           1     53     118     4.79M    194.2k    27.4k    3.060    46.7k    94.0k  bash:20 devin:8 diff-read:7 file-read:7 ci-wait:5
v1.3-task12           2    383     872    51.24M    900.4k   213.7k   21.728    46.5k   138.9k  bash:182 diff-read:56 file-read:55 devin:35 ci-wait:29
v1.3-task2            1    142     330    29.63M    530.3k   139.8k   12.967    67.1k   212.4k  bash:73 devin:17 diff-read:15 file-read:7 grep:5
v1.3-task3            1     52     112     4.63M     95.8k    31.7k    2.328    47.6k    90.9k  bash:24 diff-read:10 grep:5 file-read:5 Write:4
v1.3-task4            1    127     280    12.52M    411.8k    72.5k    7.250    47.6k   101.8k  bash:69 file-read:25 diff-read:15 ci-wait:11 devin:9
v1.3-task5            1     75     172     9.67M    140.4k    47.5k    4.008    60.4k   130.8k  bash:24 diff-read:23 file-read:8 ci-wait:7 devin:6
v1.3-task6            1     53     116     5.36M     95.0k    26.6k    2.366    60.6k   103.0k  diff-read:19 bash:17 devin:8 file-read:5 ci-wait:3
v1.3-task7            1     39      86     3.49M     66.8k    19.1k    1.615    60.6k    91.2k  bash:17 devin:8 file-read:6 diff-read:5 grep:3
v1.3-task8            1     53     118     5.43M     98.9k    27.0k    2.418    60.6k   104.3k  bash:14 diff-read:12 devin:10 file-read:10 ci-wait:5
v1.3-task9            1     43      92     3.35M     76.9k    20.5k    1.696    47.8k    79.7k  bash:14 diff-read:10 file-read:10 devin:5 grep:3
v1.4-task1            1     14      28    735.0k     30.1k     5.0k    0.487    46.7k    54.7k  diff-read:4 bash:4 devin:4 ci-wait:1
v1.4-task10           1    113     254    16.07M    779.0k    67.8k   10.804    64.8k   149.1k  bash:35 diff-read:25 file-read:14 grep:13 devin:10
v1.4-task12           1    196     464    43.45M    580.1k   139.7k   16.127    61.3k   224.7k  bash:80 diff-read:48 file-read:14 ci-wait:14 devin:10
v1.4-task13           2    248     592    37.98M    820.7k   146.4k   17.092    61.7k   154.6k  bash:112 diff-read:32 ci-wait:23 devin:22 grep:8
v1.4-task2            2    134     302    15.99M    515.6k    82.3k    8.971    46.6k   116.1k  bash:53 diff-read:28 devin:19 mcp__t3-code__t3_background_wait:8 ci-wait:7
v1.4-task3            1     33      72     2.56M     67.5k    17.0k    1.393    46.9k    79.7k  bash:14 devin:6 diff-read:6 ci-wait:4
v1.4-task4            1     37      82     3.15M     81.6k    23.1k    1.744    47.0k    87.3k  bash:16 devin:7 diff-read:7 ci-wait:3 grep:1
v1.4-task5            1     30      66     2.65M     71.6k    19.3k    1.490    59.9k    90.8k  bash:14 devin:6 diff-read:5 grep:2 ci-wait:1
v1.4-task6            1     44      92     4.50M    113.0k    29.1k    2.386    47.0k   104.7k  bash:25 devin:6 grep:6 diff-read:5 ci-wait:2
v1.4-task7            1     43      92     4.34M    109.8k    29.1k    2.330    47.1k   103.5k  bash:18 devin:9 diff-read:9 grep:3 ci-wait:2
v1.4-task8            1     37      80     3.40M     86.6k    17.8k    1.729    60.0k    94.1k  bash:15 diff-read:9 devin:7 file-read:5 ci-wait:3
v1.4-task9            1    139     310    24.60M    500.8k    96.8k   10.864    60.0k   180.6k  bash:49 diff-read:40 file-read:26 grep:7 devin:6

per task (opus only)
task               sess  turns   input  cache-rd  cache-wr   output        $    ctx1~    ctxμ~  tool mix
unattributed         45   2548    5.8k   326.90M     7.77M    1.56M  158.868    48.6k   102.8k  bash:1265 diff-read:302 devin:219 file-read:178 mcp__t3-code__t3_background_wait:135
v1.3-task1            3    143     340    19.87M    495.0k    57.6k    9.086    44.7k   114.6k  bash:62 devin:55 diff-read:13 ci-wait:7 Write:1
v1.3-task10           1     64     140     6.40M    243.3k    35.2k    3.930    47.8k   103.8k  bash:23 file-read:13 diff-read:11 devin:10 ci-wait:4
v1.3-task11           1     53     118     4.79M    194.2k    27.4k    3.060    46.7k    94.0k  bash:20 devin:8 diff-read:7 file-read:7 ci-wait:5
v1.3-task12           2    383     872    51.24M    900.4k   213.7k   21.728    46.5k   138.9k  bash:182 diff-read:56 file-read:55 devin:35 ci-wait:29
v1.3-task2            1    141     330    29.63M    530.3k   139.8k   12.967    67.1k   213.9k  bash:73 devin:17 diff-read:15 file-read:7 grep:5
v1.3-task3            1     52     112     4.63M     95.8k    31.7k    2.328    47.6k    90.9k  bash:24 diff-read:10 grep:5 file-read:5 Write:4
v1.3-task4            1    127     280    12.52M    411.8k    72.5k    7.250    47.6k   101.8k  bash:69 file-read:25 diff-read:15 ci-wait:11 devin:9
v1.3-task5            1     75     172     9.67M    140.4k    47.5k    4.008    60.4k   130.8k  bash:24 diff-read:23 file-read:8 ci-wait:7 devin:6
v1.3-task6            1     53     116     5.36M     95.0k    26.6k    2.366    60.6k   103.0k  diff-read:19 bash:17 devin:8 file-read:5 ci-wait:3
v1.3-task7            1     39      86     3.49M     66.8k    19.1k    1.615    60.6k    91.2k  bash:17 devin:8 file-read:6 diff-read:5 grep:3
v1.3-task8            1     53     118     5.43M     98.9k    27.0k    2.418    60.6k   104.3k  bash:14 diff-read:12 devin:10 file-read:10 ci-wait:5
v1.3-task9            1     43      92     3.35M     76.9k    20.5k    1.696    47.8k    79.7k  bash:14 diff-read:10 file-read:10 devin:5 grep:3
v1.4-task1            1     14      28    735.0k     30.1k     5.0k    0.487    46.7k    54.7k  diff-read:4 bash:4 devin:4 ci-wait:1
v1.4-task10           1    112     254    16.07M    779.0k    67.8k   10.804    64.8k   150.5k  bash:35 diff-read:25 file-read:14 grep:13 devin:10
v1.4-task12           1    195     464    43.45M    580.1k   139.7k   16.127    61.3k   225.8k  bash:80 diff-read:48 file-read:14 ci-wait:14 devin:10
v1.4-task13           2    248     592    37.98M    820.7k   146.4k   17.092    61.7k   154.6k  bash:112 diff-read:32 ci-wait:23 devin:22 grep:8
v1.4-task2            2    134     302    15.99M    515.6k    82.3k    8.971    46.6k   116.1k  bash:53 diff-read:28 devin:19 mcp__t3-code__t3_background_wait:8 ci-wait:7
v1.4-task3            1     33      72     2.56M     67.5k    17.0k    1.393    46.9k    79.7k  bash:14 devin:6 diff-read:6 ci-wait:4
v1.4-task4            1     37      82     3.15M     81.6k    23.1k    1.744    47.0k    87.3k  bash:16 devin:7 diff-read:7 ci-wait:3 grep:1
v1.4-task5            1     30      66     2.65M     71.6k    19.3k    1.490    59.9k    90.8k  bash:14 devin:6 diff-read:5 grep:2 ci-wait:1
v1.4-task6            1     44      92     4.50M    113.0k    29.1k    2.386    47.0k   104.7k  bash:25 devin:6 grep:6 diff-read:5 ci-wait:2
v1.4-task7            1     43      92     4.34M    109.8k    29.1k    2.330    47.1k   103.5k  bash:18 devin:9 diff-read:9 grep:3 ci-wait:2
v1.4-task8            1     37      80     3.40M     86.6k    17.8k    1.729    60.0k    94.1k  bash:15 diff-read:9 devin:7 file-read:5 ci-wait:3
v1.4-task9            1    139     310    24.60M    500.8k    96.8k   10.864    60.0k   180.6k  bash:49 diff-read:40 file-read:26 grep:7 devin:6

summary
version        sess tasks  turns  cache-rd  cache-wr   output        $    $opus  $/task~    ctx1~    ctxμ~
unattributed     46     1   2788   373.43M     8.36M    1.69M  166.899  158.868  166.899    48.7k   103.8k
v1.3             15    12   1231   156.38M     3.35M   718.8k   72.452   72.452    3.495    47.6k   103.8k
v1.4             14    12   1068   159.42M     3.76M   673.5k   75.415   75.415    2.358    53.5k   104.1k
total            75    25   5087   689.23M    15.47M    3.08M  314.766  306.736    3.060    48.4k   103.8k
```
