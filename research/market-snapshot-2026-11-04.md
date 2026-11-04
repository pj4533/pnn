# What the markets were pricing on 2026-11-04, the morning after the midterms

This is a hand-pulled snapshot from the live APIs: the evidence that there's enough day-to-day content for a 24/7 channel. Raw data is in `samples/`.

## Polymarket: the most-traded events in 24h, excluding sports and crypto

| 24h volume | Event |
| --- | --- |
| $14.2M | Which Senate swing states will Republicans win? |
| $12.9M | Balance of Power: 2026 Midterms |
| $4.2M | Republican presidential nominee 2028 |
| $2.8M | Democratic presidential nominee 2028 |
| $1.5M | Fed decision in December? |
| $1.4M | US–Iran ceasefire continues through…? |
| $1.2M | Will the US confirm that aliens exist by…? |
| $1.1M | Prime Minister of Israel after the next election? |
| $1.0M | Israel x Iran ceasefire continues through…? |
| $0.7M | Will the U.S. invade Iran before 2027? |
| $0.6M | US announces end of Iranian blockade by…? |
| $0.5M | Elon Musk # tweets this week (several overlapping windows) |
| $0.27M | Putin out as President of Russia by…? |
| $0.23M | Trump out as President before 2027? |
| $0.20M | Israel military action against Beirut by…? |
| $0.19M | Iran leadership change by…? |
| $0.18M | California billionaire wealth tax passes? |
| $0.17M | Strait of Hormuz traffic returns to normal by…? |
| $0.14M | WTI crude oil price in November; Xi Jinping out before 2027? |
| $0.13M | Will Samuel Alito announce his retirement by…? |
| $0.12M | Trump declares election-interference national emergency by…? |
| $0.11M | China invades Taiwan by end of 2026?; Iranian regime falls before 2027? |
| $0.10M | Another Fed rate hike in 2026?; Anthropic IPO closing market cap |

**Tags across the top 100 events by 24h volume:** Sports 43, Politics 40, Games 37, Elections 23, Geopolitics 16, Trump 11, Iran 11, Crypto 9, Oil 6, Culture 4. About half are sports, esports or crypto, so a news channel has to filter.

## Biggest 24h movers (Polymarket `oneDayPriceChange`, volume > $20K, non-sports)

| Move | Now | Market |
| --- | --- | --- |
| +91 | 95% | Democrat wins TX Senate by 12%+ |
| +71 | 83% | Democrats win Mississippi Senate |
| +64 | 99% | Democrats win Kansas governor |
| +59 | 98% | Nithya Raman wins LA mayor |
| −58 | 1% | Karen Bass wins LA mayor |
| +24 | 100% | Balance of Power: D Senate, D House |
| −20 | 3% | California billionaire tax passes |
| +16 | 87% | Mary Peltola wins Alaska Senate |
| +12 | 16% | DeSantis wins 2028 GOP nomination |
| +12 | 29% | Jon Ossoff wins 2028 Dem nomination |
| +7 | 80% | Fed hikes 25 bps in December |

Each row is effectively a headline: *"Bettors now give Jon Ossoff a 29% chance at the 2028 Democratic nomination, up 12 points overnight."* The Ossoff and DeSantis moves are stories the markets priced before pundits wrote them up.

## Kalshi recurring series: the always-on supply

There are about 1,330 series that repeat hourly, daily, weekly or monthly. Some examples:

| Area | Recurring markets |
| --- | --- |
| Politics | Trump approval up or down this week; 538 approval this week; "EO this week?"; bills signed monthly; tariffs on Canada |
| Economics | CPI and inflation; gas prices by state; US–China trade deficit |
| Weather | daily max temperature by city (Newark, Houston…); rain in NYC, Paris, Minneapolis |
| Travel | TSA daily check-ins; O'Hare and JFK delays and cancellations; freight rates |
| Health | weekly COVID cases; Ozempic and Wegovy prescriptions |
| Entertainment | Billboard Hot 100 #1; top streaming show by hours watched; album sales |
| Science and tech | H100, H200 and B200 GPU rental prices; AI adoption by industry |

## Content pitfalls seen in the data
- **Noise:**
  - Sports, esports and crypto price brackets dominate by count.
  - Novelty markets like Musk tweet counts.
  - Promotional tags such as "Rewards" and "Earn 3.25%".
- **Thin markets** swing wildly, so weight moves by volume and liquidity.
- **"By date X" markets decay toward 0** as the deadline nears even when nothing happens. That kind of move is not news.
- **Repeated outcomes:** multi-outcome events (one market per candidate or bracket) can flood a movers list with the same story. Group by event.
- **Sensitive topics:** war, death and assassination markets. Fox refuses to air these, and PNN needs an explicit policy.
