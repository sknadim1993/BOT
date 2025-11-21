import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Play, StopCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Settings, InsertSettings } from "@shared/schema";

interface ControlPanelProps {
  settings?: Settings;
}

export function ControlPanel({ settings }: ControlPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [leverage, setLeverage] = useState(50);
  const [balanceAllocation, setBalanceAllocation] = useState(100);
  const [concurrentTrades, setConcurrentTrades] = useState(1);
  const [autoTrading, setAutoTrading] = useState(false);

  useEffect(() => {
    if (settings) {
      setLeverage(settings.leverage);
      setBalanceAllocation(settings.balanceAllocation);
      setConcurrentTrades(settings.concurrentTrades);
      setAutoTrading(settings.autoTradingEnabled);
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: async (data: Partial<InsertSettings>) => {
      return apiRequest('PUT', '/api/settings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({
        title: "Settings updated",
        description: "Your trading parameters have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update settings.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateSettings.mutate({
      leverage,
      balanceAllocation,
      concurrentTrades,
      autoTradingEnabled: autoTrading,
    });
  };

  const toggleAutoTrading = () => {
    const newValue = !autoTrading;
    setAutoTrading(newValue);
    updateSettings.mutate({ autoTradingEnabled: newValue });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Control Panel</CardTitle>
        <CardDescription>Configure trading parameters and automation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Leverage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="leverage">Leverage</Label>
            <span className="text-sm font-mono font-semibold" data-testid="text-leverage-value">{leverage}x</span>
          </div>
          <Slider
            id="leverage"
            min={1}
            max={100}
            step={1}
            value={[leverage]}
            onValueChange={(value) => setLeverage(value[0])}
            data-testid="slider-leverage"
          />
          <p className="text-xs text-muted-foreground">1x - 100x</p>
        </div>

        {/* Balance Allocation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="balance">Balance Allocation</Label>
            <span className="text-sm font-mono font-semibold" data-testid="text-balance-value">{balanceAllocation}%</span>
          </div>
          <Slider
            id="balance"
            min={10}
            max={100}
            step={5}
            value={[balanceAllocation]}
            onValueChange={(value) => setBalanceAllocation(value[0])}
            data-testid="slider-balance"
          />
          <p className="text-xs text-muted-foreground">10% - 100%</p>
        </div>

        {/* Concurrent Trades */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="concurrent">Concurrent Trades</Label>
            <span className="text-sm font-mono font-semibold" data-testid="text-concurrent-value">{concurrentTrades}</span>
          </div>
          <Slider
            id="concurrent"
            min={1}
            max={10}
            step={1}
            value={[concurrentTrades]}
            onValueChange={(value) => setConcurrentTrades(value[0])}
            data-testid="slider-concurrent"
          />
          <p className="text-xs text-muted-foreground">1 - 10 positions</p>
        </div>

        {/* Auto-Trading Toggle */}
        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="auto-trading" className="text-base">Auto-Trading</Label>
            <p className="text-sm text-muted-foreground">Enable autonomous trade execution</p>
          </div>
          <Switch
            id="auto-trading"
            checked={autoTrading}
            onCheckedChange={toggleAutoTrading}
            data-testid="switch-auto-trading"
          />
        </div>

        {/* Save Button */}
        <div className="flex gap-2">
          <Button 
            className="flex-1" 
            onClick={handleSave}
            disabled={updateSettings.isPending}
            data-testid="button-save-settings"
          >
            {autoTrading ? (
              <>
                <StopCircle className="mr-2 h-4 w-4" />
                Save & Running
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
