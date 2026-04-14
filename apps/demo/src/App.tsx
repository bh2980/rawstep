import {
  Bug,
  CreditCard,
  LogIn,
  Search,
  ShieldCheck,
  SquareMousePointer,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const realisticFlows = [
  {
    icon: LogIn,
    title: "Credential login",
    summary: "이메일, 비밀번호, 오류 상태, 성공 redirect를 한 화면에서 검증하기 좋습니다.",
    task: "이메일과 비밀번호를 입력하고 sign in 버튼을 눌러 dashboard로 이동한다.",
  },
  {
    icon: Search,
    title: "Search and filter",
    summary: "입력, 결과 목록, empty state, active filter 이동을 묶어서 만들 수 있습니다.",
    task: "검색어를 넣고 첫 번째 결과를 열어 상세 화면 제목이 보이게 만든다.",
  },
  {
    icon: CreditCard,
    title: "Checkout step",
    summary: "주소 입력, 체크박스, summary panel, submit 오류 처리까지 확장하기 좋습니다.",
    task: "배송 옵션을 바꾸고 place order 버튼을 눌러 완료 메시지를 확인한다.",
  },
] as const

const brokenStates = [
  "label 없는 icon button",
  "닫히지 않는 dialog",
  "tab 순서가 꼬인 checkout form",
  "error text는 있는데 focus 이동이 없는 login form",
] as const

function App() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f3ee_0%,#fbfaf8_48%,#ffffff_100%)] text-foreground">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-0 bg-[linear-gradient(135deg,#13212e_0%,#1d3346_52%,#2f5764_100%)] text-white ring-0 shadow-[0_24px_80px_rgba(19,33,46,0.24)]">
            <CardHeader className="gap-3">
              <Badge className="w-fit bg-white/14 text-white hover:bg-white/14">
                apps/demo starter
              </Badge>
              <CardTitle className="max-w-3xl text-3xl md:text-5xl">
                realistic task용 화면을 빨리 조립할 수 있는 데모 앱
              </CardTitle>
              <CardDescription className="max-w-2xl text-base text-white/74">
                정적 fixture는 그대로 두고, 로그인, 검색, checkout 같은 실제 흐름은
                여기서 shadcn 컴포넌트로 빠르게 조립하면 됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-sm text-white/68">Run</p>
                <p className="mt-2 font-mono text-sm">pnpm demo:dev</p>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-sm text-white/68">Build</p>
                <p className="mt-2 font-mono text-sm">pnpm demo:build</p>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-sm text-white/68">Alias</p>
                <p className="mt-2 font-mono text-sm">@/components, @/lib</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white/88 shadow-[0_20px_60px_rgba(19,33,46,0.08)] backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-xl">What is ready now</CardTitle>
              <CardDescription>
                Tailwind v4, shadcn/ui, Lucide, import alias, Vite dev/build가
                바로 동작합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                <ShieldCheck className="mt-0.5 size-5 text-emerald-700" />
                <div>
                  <p className="font-medium">Smoke test와 분리</p>
                  <p className="text-sm text-muted-foreground">
                    기존 <code>fixtures/*.html</code> 는 가볍게 유지하고, 무거운
                    시나리오는 이 앱에 넣습니다.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                <SquareMousePointer className="mt-0.5 size-5 text-sky-700" />
                <div>
                  <p className="font-medium">컴포넌트 추가 준비 완료</p>
                  <p className="text-sm text-muted-foreground">
                    <code>pnpm dlx shadcn@latest add ... -c apps/demo</code> 로
                    필요한 부품만 더 가져오면 됩니다.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="flows" className="gap-5">
          <TabsList variant="line" className="w-full justify-start gap-2">
            <TabsTrigger value="flows">Starter flows</TabsTrigger>
            <TabsTrigger value="broken">Broken states</TabsTrigger>
            <TabsTrigger value="playground">Playground</TabsTrigger>
          </TabsList>

          <TabsContent value="flows">
            <div className="grid gap-5 lg:grid-cols-3">
              {realisticFlows.map(({ icon: Icon, title, summary, task }) => (
                <Card key={title} className="bg-white/92 shadow-[0_16px_40px_rgba(19,33,46,0.06)]">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex size-11 items-center justify-center rounded-2xl bg-[#d8efe8] text-[#145a4b]">
                        <Icon className="size-5" />
                      </div>
                      <Badge variant="secondary">task seed</Badge>
                    </div>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{summary}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="rounded-2xl bg-muted/55 p-4 text-sm leading-6 text-muted-foreground">
                      {task}
                    </p>
                  </CardContent>
                  <CardFooter className="justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      컴포넌트 조합 후 task만 추가하면 됩니다.
                    </span>
                    <Button variant="outline" size="sm">
                      Copy idea
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="broken">
            <Card className="bg-white/92 shadow-[0_16px_40px_rgba(19,33,46,0.06)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bug className="size-5 text-[#9a3412]" />
                  일부러 망가뜨릴 만한 상태
                </CardTitle>
                <CardDescription>
                  좋은 컴포넌트만 있으면 테스트가 너무 착해집니다. 실패 케이스도
                  같이 만들어야 rawstep 예제가 강해집니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {brokenStates.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-dashed border-[#e7b59f] bg-[#fff5ef] p-4 text-sm"
                  >
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="playground">
            <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
              <Card className="bg-white/92 shadow-[0_16px_40px_rgba(19,33,46,0.06)]">
                <CardHeader>
                  <CardTitle>Quick login scaffold</CardTitle>
                  <CardDescription>
                    realistic task의 첫 재료로 바로 바꿔 쓰기 좋은 미니 폼입니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email">Work email</Label>
                    <Input id="email" type="email" placeholder="traveler@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder="Use a fake seed value" />
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-4">
                    <Checkbox id="remember" defaultChecked />
                    <Label htmlFor="remember" className="leading-6">
                      Remember this device for 14 days
                    </Label>
                  </div>
                  <Separator />
                  <div className="flex flex-wrap gap-3">
                    <Button>Sign in</Button>
                    <Button variant="outline">Use magic link</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/92 shadow-[0_16px_40px_rgba(19,33,46,0.06)]">
                <CardHeader>
                  <CardTitle>Component smoke check</CardTitle>
                  <CardDescription>
                    설치가 끝났는지 눈으로 바로 확인하는 용도입니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge>button</Badge>
                    <Badge variant="secondary">card</Badge>
                    <Badge variant="secondary">tabs</Badge>
                    <Badge variant="secondary">dialog</Badge>
                    <Badge variant="secondary">input</Badge>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">Open preview dialog</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Demo dialog is wired</DialogTitle>
                        <DialogDescription>
                          여기서 checkout confirm, delete confirm, error modal 같은
                          task용 상태를 바로 만들 수 있습니다.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter showCloseButton />
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  )
}

export default App
