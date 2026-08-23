import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DotsThreeVerticalIcon,
  HeartbeatIcon,
  InfoIcon,
  LockKeyIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

function App() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b bg-card/95">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                UAE Health
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Design foundation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="Open preview menu" size="icon" variant="outline">
                  <DotsThreeVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Preview options</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>English interface</DropdownMenuItem>
                <DropdownMenuItem>RTL-ready components</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <section className="grid gap-8 border-b pb-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:items-end">
          <div>
            <Badge variant="info">
              <InfoIcon aria-hidden="true" />
              Synthetic preview
            </Badge>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              A calm foundation for high-stakes care.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Accessible components, durable semantic tokens, and predictable
              interaction states for the HIS modules ahead.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Button>
              <PlusIcon aria-hidden="true" />
              Add patient
            </Button>
            <Button variant="outline">View documentation</Button>
          </div>
        </section>

        <div className="grid gap-10 py-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <section aria-labelledby="form-heading">
            <div className="mb-6">
              <h2 id="form-heading" className="text-xl font-semibold">
                Patient context
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Example fields use synthetic details and demonstrate labels,
                help text, validation, and facility scope.
              </p>
            </div>

            <form className="grid gap-5 rounded-xl border bg-card p-5 shadow-[0_12px_35px_rgba(30,73,79,0.07)] sm:p-6">
              <div className="grid gap-2">
                <Label htmlFor="patient-name">Patient name</Label>
                <Input
                  aria-describedby="patient-name-help"
                  autoComplete="off"
                  id="patient-name"
                  placeholder="Enter a synthetic patient name"
                />
                <p id="patient-name-help" className="text-sm text-muted-foreground">
                  Do not enter real patient information in this environment.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="mobile-number">Mobile number</Label>
                  <Input
                    aria-describedby="mobile-number-error"
                    aria-invalid="true"
                    id="mobile-number"
                    inputMode="tel"
                    placeholder="050 000 0000"
                  />
                  <p
                    className="flex items-start gap-1.5 text-sm text-destructive"
                    id="mobile-number-error"
                  >
                    <WarningCircleIcon aria-hidden="true" className="mt-0.5 shrink-0" />
                    Use a synthetic UAE mobile number.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="facility">Facility</Label>
                  <Select defaultValue="demo-clinic">
                    <SelectTrigger id="facility">
                      <SelectValue placeholder="Select a facility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="demo-clinic">Demo Clinic</SelectItem>
                      <SelectItem value="training-hospital">Training Hospital</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="visit-note">Visit note</Label>
                <Textarea
                  id="visit-note"
                  placeholder="Add a non-clinical synthetic note"
                />
              </div>

              <div className="flex items-start gap-3 rounded-md bg-muted p-4">
                <Checkbox id="confidential-record" />
                <div className="grid gap-1">
                  <Label htmlFor="confidential-record">Confidential record</Label>
                  <p className="text-sm leading-5 text-muted-foreground">
                    Restricted records require an access reason and additional audit.
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
                <Button variant="outline">Cancel</Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>Review patient</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Review synthetic patient</DialogTitle>
                      <DialogDescription>
                        Confirm that this preview contains no real patient or provider data.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter showCloseButton>
                      <Button>Confirm review</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </form>
          </section>

          <aside className="grid content-start gap-8" aria-label="Component states">
            <section aria-labelledby="status-heading">
              <h2 id="status-heading" className="text-xl font-semibold">
                Status language
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Color is reinforced with text and icons.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="success">
                  <CheckCircleIcon aria-hidden="true" />
                  Verified
                </Badge>
                <Badge variant="warning">
                  <WarningCircleIcon aria-hidden="true" />
                  Review needed
                </Badge>
                <Badge variant="destructive">
                  <LockKeyIcon aria-hidden="true" />
                  Restricted
                </Badge>
                <Badge variant="outline">Draft</Badge>
              </div>
            </section>

            <Separator />

            <section aria-labelledby="loading-heading">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="loading-heading" className="text-base font-semibold">
                    Loading state
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Skeletons follow the expected content shape.
                  </p>
                </div>
                <Button disabled size="sm" variant="secondary">
                  <ArrowClockwiseIcon aria-hidden="true" className="animate-spin" />
                  Loading
                </Button>
              </div>
              <div
                aria-label="Loading patient summary"
                className="mt-4 grid gap-3 rounded-xl border bg-card p-4"
                role="status"
              >
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <span className="sr-only">Loading patient summary</span>
              </div>
            </section>

            <Separator />

            <section aria-labelledby="empty-heading">
              <div className="rounded-xl border border-dashed bg-card p-5">
                <h2 id="empty-heading" className="text-base font-semibold">
                  No recent registrations
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  New synthetic registrations will appear here after they are saved.
                </p>
                <Button className="mt-4" size="sm" variant="outline">
                  <ArrowClockwiseIcon aria-hidden="true" />
                  Refresh
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}

export default App
