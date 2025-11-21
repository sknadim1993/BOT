import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Calendar, TrendingUp, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TradingMode } from "@shared/schema";

const MODES = [
  { id: 'scalping' as TradingMode, label: 'Scalping', timeframe: '5m', icon: Zap, description: 'Ultra-fast trades' },
  { id: 'intraday' as TradingMode, label: 'Intraday', timeframe: '15m', icon: Clock, description: 'Day trading' },
  { id: 'swing' as TradingMode, label: 'Swing', timeframe: '1H', icon: TrendingUp, description: 'Multi-day holds' },
  { id: 'longterm' as TradingMode, label: 'Long-Term', timeframe: '1D', icon: Calendar, description: 'Position trading' },
];

interface TradingModeSelectorProps {
  currentMode: TradingMode;
}

export function TradingModeSelector({ currentMode }: TradingModeSelectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateMode = useMutation({
    mutationFn: async (mode: TradingMode) => {
      return apiRequest('PUT', '/api/settings', { tradingMode: mode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({
        title: "Trading mode updated",
        description: "Your trading strategy has been changed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update trading mode.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trading Mode</CardTitle>
        <CardDescription>Select your trading strategy and timeframe</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = currentMode === mode.id;
            
            return (
              <Button
                key={mode.id}
                variant={isActive ? "default" : "outline"}
                className="h-auto flex-col gap-2 p-4"
                onClick={() => updateMode.mutate(mode.id)}
                disabled={updateMode.isPending}
                data-testid={`button-mode-${mode.id}`}
              >
                <Icon className="h-5 w-5" />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-sm font-semibold">{mode.label}</span>
                  <span className="text-xs font-mono opacity-80">{mode.timeframe}</span>
                  <span className="text-xs opacity-70">{mode.description}</span>
                </div>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
