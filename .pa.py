p='src/lib/services/dpdp-auth-template.test.ts'
s=open(p,encoding='utf-8',newline='').read()
a="expect(out).toBe(OLD_TEXT.join('\n'))"
assert a in s
s=s.replace(a,"expect(out).toBe(`${OLD_TEXT[0]}\n\n${OLD_TEXT[1]}\n${OLD_TEXT[2]}`)")
open(p,'w',encoding='utf-8',newline='').write(s)
