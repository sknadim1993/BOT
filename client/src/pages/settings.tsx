import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, CheckCircle, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import type { Settings } from "@shared/schema";

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'error' | null>(null);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['/api/settings'],
  });

  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus(null);
    
    try {
      await apiRequest('POST', '/api/settings/test-connection', {});
      setConnectionStatus('success');
      toast({
        title: "Connection successful",
        description: "Delta Exchange API is connected and working.",
      });
    } catch (error) {
      setConnectionStatus('error');
      toast({
        title: "Connection failed",
        description: "Unable to connect to Delta Exchange API. Check your credentials.",
        variant: "destructive",
      });
    } finally {
      setTestingConnection(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure your trading bot and API connections</p>
      </div>

      {/* Current Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Current Configuration</CardTitle>
          <CardDescription>Active trading parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="text-sm text-muted-foreground">Trading Mode</Label>
              <p className="text-lg font-semibold capitalize mt-1" data-testid="text-config-mode">
                {settings?.tradingMode || 'Not set'}
              </p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Auto-Trading</Label>
              <div className="mt-1">
                <Badge variant={settings?.autoTradingEnabled ? "default" : "secondary"} data-testid="badge-auto-trading">
                  {settings?.autoTradingEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Leverage</Label>
              <p className="text-lg font-semibold font-mono mt-1" data-testid="text-config-leverage">
                {settings?.leverage}x
              </p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Balance Allocation</Label>
              <p className="text-lg font-semibold font-mono mt-1" data-testid="text-config-balance">
                {settings?.balanceAllocation}%
              </p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Concurrent Trades</Label>
              <p className="text-lg font-semibold font-mono mt-1" data-testid="text-config-concurrent">
                {settings?.concurrentTrades}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Connections */}
      <Card>
        <CardHeader>
          <CardTitle>API Connections</CardTitle>
          <CardDescription>Test and verify external service connections</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-md">
              <div className="space-y-1">
                <Label className="text-base">Delta Exchange API</Label>
                <p className="text-sm text-muted-foreground">Trading execution and market data</p>
              </div>
              <div className="flex items-center gap-2">
                {connectionStatus === 'success' && (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Connected
                  </Badge>
                )}
                {connectionStatus === 'error' && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    Failed
                  </Badge>
                )}
                <Button
                  onClick={testConnection}
                  disabled={testingConnection}
                  size="sm"
                  data-testid="button-test-connection"
                >
                  {testingConnection ? "Testing..." : "Test Connection"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-md">
              <div className="space-y-1">
                <Label className="text-base">Groq API</Label>
                <p className="text-sm text-muted-foreground">AI-powered market analysis</p>
              </div>
              <Badge variant="outline">Configured</Badge>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-md">
              <div className="space-y-1">
                <Label className="text-base">Supabase Database</Label>
                <p className="text-sm text-muted-foreground">Trade history and analytics storage</p>
              </div>
              <Badge variant="outline">Configured</Badge>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-md">
              <div className="space-y-1">
                <Label className="text-base">Resend Email</Label>
                <p className="text-sm text-muted-foreground">Trade notifications and daily reports</p>
              </div>
              <Badge variant="outline">Configured</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Information */}
      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
          <CardDescription>Bot status and configuration details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Last Updated:</span>
            <span className="font-mono">{settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : 'N/A'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Risk:Reward Ratio:</span>
            <span className="font-mono">1:2</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Supported Timeframes:</span>
            <span className="font-mono">5m, 15m, 1H, 1D</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
