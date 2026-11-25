#!/bin/sh
# Waits until the Unreal Editor opened on ue/MarketDistrict is up: its log shows the engine initialized and frames
# ticking past the first few, and its MCP server answers on 127.0.0.1:8000.
L="$HOME/Library/Logs/Unreal Engine/MarketDistrictEditor/MarketDistrict.log"
i=0
while [ $i -lt 150 ]; do
  if [ -f "$L" ] && grep -q "Engine is initialized" "$L" && tail -3 "$L" | grep -q "\]\[ *[1-9][0-9]*\]"; then
    if curl -s -m 2 -o /dev/null -X POST http://127.0.0.1:8000/mcp -H 'Content-Type: application/json' -d '{}'; then echo "editor up after $((i * 4)) s"; exit 0; fi
  fi
  i=$((i + 1)); sleep 4
done
echo "editor not up"; tail -5 "$L" | cut -c1-200; exit 1
