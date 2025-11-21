import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Trade } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

export default function TradeHistory() {
  const { data: trades, isLoading } = useQuery<Trade[]>({
    queryKey: ['/api/trades'],
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const closedTrades = trades?.filter(t => t.status !== 'open') || [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-history-title">Trade History</h1>
        <p className="text-sm text-muted-foreground">Complete record of all executed trades</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Trades</CardTitle>
          <CardDescription>{closedTrades.length} completed trades</CardDescription>
        </CardHeader>
        <CardContent>
          {closedTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No trade history yet</p>
              <p className="text-xs text-muted-foreground mt-1">Completed trades will appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Exit</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedTrades.map((trade) => {
                    const pnl = trade.pnl ? parseFloat(trade.pnl.toString()) : 0;
                    const pnlPct = trade.pnlPercentage ? parseFloat(trade.pnlPercentage.toString()) : 0;
                    
                    return (
                      <TableRow key={trade.id} data-testid={`row-history-${trade.symbol}`}>
                        <TableCell className="text-sm">
                          {trade.exitTime ? format(new Date(trade.exitTime), 'MMM dd, HH:mm') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-semibold">{trade.symbol}</TableCell>
                        <TableCell className="capitalize text-sm">{trade.tradingMode}</TableCell>
                        <TableCell>
                          <Badge variant={trade.direction === 'long' ? 'default' : 'destructive'} className="font-mono">
                            {trade.direction === 'long' ? (
                              <><ArrowUpRight className="mr-1 h-3 w-3" />LONG</>
                            ) : (
                              <><ArrowDownRight className="mr-1 h-3 w-3" />SHORT</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">${parseFloat(trade.entryPrice.toString()).toFixed(2)}</TableCell>
                        <TableCell className="font-mono">
                          {trade.exitPrice ? `$${parseFloat(trade.exitPrice.toString()).toFixed(2)}` : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <div className={`font-mono font-semibold ${pnl >= 0 ? 'text-chart-2' : 'text-destructive'}`}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} INR
                            <span className="text-xs ml-1">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            trade.status === 'tp_hit' ? 'default' : 
                            trade.status === 'sl_hit' ? 'destructive' : 
                            'secondary'
                          }>
                            {trade.status === 'tp_hit' ? 'TP Hit' : 
                             trade.status === 'sl_hit' ? 'SL Hit' : 
                             trade.status.replace('_', ' ').toUpperCase()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
