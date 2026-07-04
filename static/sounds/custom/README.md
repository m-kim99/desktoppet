# 🔊 커스텀 발소리 폴더 (git에 올라가지 않음)

여기에 개인 소장 발소리 파일을 넣고 `manifest.json`을 만들면
기본(Kenney CC0) 발소리 대신 사용됩니다. 표면별로 여러 개 넣으면 랜덤 로테이션돼요.

`manifest.json` 예시:

```json
{
  "grass": ["my_grass1.mp3", "my_grass2.mp3"],
  "road":  ["my_floor1.mp3"],
  "wood":  ["my_wood1.mp3", "my_wood2.mp3"]
}
```

- grass = 잔디 위 / road = 도로·광장 / wood = 다리 위
- 비워두거나 파일이 없으면 해당 표면은 기본 사운드로 돌아갑니다.
- 이 폴더는 .gitignore에 등록되어 공개 저장소에 커밋되지 않습니다.
