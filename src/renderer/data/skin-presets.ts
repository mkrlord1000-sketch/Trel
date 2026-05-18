// AUTO-GENERATED. Не редактируй вручную — правь scripts/generate-skins.ts
export interface SkinPreset {
  id: string;
  name: string;
  category: 'male' | 'female' | 'neutral';
  description: string;
  /** PNG-data-URL, готов к сохранению в accounts.json. */
  dataUrl: string;
  /** Какую модель скина рекомендуем для этого пресета. */
  model: 'classic' | 'slim';
}

export const SKIN_PRESETS: SkinPreset[] = [
  {
    id: "m-cyber-soldier",
    name: "Кибер-солдат",
    category: "male",
    description: "Тактическая броня с циан-визором и подсветкой нагрудника",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACE0lEQVR4Ae3BMUsbYRjA8f89fU0lFKdzyXAtOHSqUByKINgOXXRppi4ZQsdAvk7mfAGhsxA6SCGdAhYCQg6OSFHESUpIL3decXsq8jbi1Ubf9/cL+It6o11gkYyG2Az6vYA7eF//9AGLH8kRNsPB189YCI4THCc4TnCc4DjBcYLjgrc7HwssKpVlbNJ0ik2eZdik6ayOxVLlKTaz9Bc2eZ5hIzjOMIfxOOYmUbTGQ2eYQxSt8VgZ5lDtdLnJpNXkoTPMYdJqMl57gRbFCY+BYU5RnPAYCY4LuGZze7dAOTs9RouPDgMs6o12gUUyGmIz6PcCLOqNdoGSjIZog34v4BYExwmOExwXrG9sFSjGLKFl2QztMs/RwlqEdnHxkythGKKdn59zZWXlGVqeZdg8MQatUllGS9MpWp5laAf7ewEWwj9W7XRZZIaShWHITcIw5EqaTlkkguMExwmOExwnOE54gKqdLtVOlzIYrjkZx2irtYhFM2k1KYuhZN+/feEPG8/RXr7eZJEYSvbqzTts0nSK53me53me53me53ne/xRQss3t3QLl7PQYLT46DLCoN9oFSjIaog36vYASCY4THCc4LuCO1je2ChRjltCybIZ2medoYS1Cq1SW0dJ0ipZnGdrB/l7AHQiOExwnOE5wnOA4wXGC44QFVO10qXa63AdDyU7GMdpqLeK2Jq0m90VwnOC43xGXkk25rqB+AAAAAElFTkSuQmCC",
  },
  {
    id: "m-techno-pilot",
    name: "Техно-пилот",
    category: "male",
    description: "Лётный комбинезон с фиолетовой нашивкой и наушниками",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAB8UlEQVR4Ae3BMUibURSA0e9do1gnaVfNImKngC5Z7WA7dAqIdMigUBxd/IcOFToKOjmKs0PpWrAZ6lRIJJuQyeCiLmIIgkaMyetUuAh9NiRi6n3nOB7wOp32BHz5vELIh+XE0ccE4wTjBOME4wTjBOME41z1YM8T8H5+mZDv37YJubpuEJKZzTmekGBcigcUf34l5KJW538m9LmNNe/5i4017+mS8I8WR7L8sTiS5blw1YM9T8Crl6OEXNTqhFxdNwjJzOYcT0jowHqSsJ4kPCcpOvBpc5PnxnFPZmLVo9QuD9FOzguOgPzcmSfg6HSXkGIlcQTk5848ytHpLlqxkjg6IBgnGCcY5ybH8h5lQIbRWu0btHa7iTY1voT25u07QvYLP9DuWg1CUgMv0IYGR9Fum3W0u1YDrVDOOQJS9Niv/RLax5UsO1sl+pVgnGCcYJxgnGCcYJxgXIp70jNNtOMyfaVUXUCbTm/TDcE44ZHtbJWIoiiKoiiKoiiKoijqJ44ey0ysepTa5SHayXnBEZCfO/MoR6e7aMVK4ughwTjBOME4R5cmx/IeZUCG0VrtG7R2u4k2Nb6ENjQ4inbbrKPdtRpohXLO0QXBOME4wTjBOME4wTjBOMG4FD2WnmmiHZfpSKm6gDad3uYxCcYJxv0GlFmFF6nX69MAAAAASUVORK5CYII=",
  },
  {
    id: "m-ranger",
    name: "Рейнджер пустошей",
    category: "male",
    description: "Плащ, броня, янтарный визор",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACA0lEQVR4Ae3BMUsjQRiA4Xe+ncQmahOLNFsIgtW2OauzyfX2/jP/ib8ggmAXcmBAl4QcsgRSuruze9XBIGEukgjqN89j+I/RRdYSsHhZETKZzQ07uPqZjQl4+rMi5OH3/AcBgnKCcoJygnKCcoJygnJmmJ21BHRsQkhVO0Jc0xDSO5A7Aro2IaSsHSHONYQIygnKWbaQLws2SQd9vjphS883Kf8836R8F2aYnbUEdGxCvizYJB30qWpHiGsaQnoHckdA1yaElLUjxLmGEMsWfg3P2WSaF3x1li1M84LvyvDG1eiixfO0eMH3MJkZAq5HWUvA42JFyHgyNwRcj7IWz+NihW88mRveQVBOUE5QzlwOsxZPt2PxlVWNz7kG32Hyiq/bSQgpK4evdg0hNhF83U6Cr6wcvto1+G7vZ4YAywdI0z6b5HnBZyMoJygnKCcoZ/kAeV7wVVj2bJqvCTkd9PhMLG8UyyW+o/4J73GeHjPN15ynx2xSVo5dTPM1vtNBj10IygnKCVEURVEURVEURVEURcoY9uxqdNHieVq84HuYzAwB16OsxfO4WOEbT+aGPRKUE5QTlDPs6HKYtXi6HYuvrGp8zjX4DpNXfN1Ogq+sHL7aNfhu72eGHQjKCcoJygnKCcoJygnKWfasWC7xHfVPeI9pvsZ3OujxkQTlBOUE5f4CyZyf7kOt2DUAAAAASUVORK5CYII=",
  },
  {
    id: "f-neon-hacker",
    name: "Неон-хакер",
    category: "female",
    description: "Розовые волосы, толстовка, киберпанк-граффити",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACF0lEQVR4Ae3BsUsbYRjA4d/3ejh0SSkBLZgsds7SwQaKgkMX6eBWxLH0L8jkmNm5k4NLhU5ZutQhk8W4O3TICR6hlHgET2oKct51CrxI+2lIQmO+73kM98jrrRyLz4tH2Lz7UDOMIP/4o4XFl28H2Lz9VHuFheA4wXGC4wTHCY4THCc4zuT1Vs5/FPcvT7AoPnmKTdy/xObXzW9sBMcFPECyxV8VDnj0hHskW/xTssWjJzxQoRYzUKjFzArhgZLdIgPJbpFZIQzhqLbHUW2PWRIwhNe775k1hjuWS9Uc5eq6i3bRCw0W1cp2jkW318Ym7LQMFtXKdo7S7bXRwk7LMATBcYLjBMeZpYVKjiISoGVZipblGVqxUEZbfPYCm5+9NlqWpdiIBGjB3DxaenuDlmUp2ml4aLAQxixOIuIkIk4i4iTi6/M3xElEnETEScS0ERwnOE5wnDAh5WaDgXKzwbQSJiRa32QgWt9kWgmOExwX8MiUmw20s7UNRhFwx/lKHa10vMM02e+foK0yGmHCXn7fw/M8z/M8z/M8z/M8b5oYxmy5VM1Rrq67aBe90GBRrWznKN1eGy3stAxjJDhOcJzgOMOIlhYqOYpIgJZlKVqWZ2jFQhktmJtHS29v0LIsRTsNDw0jEBwnOE5wnOA4wXGC4wTHCY4LmDLlZgPtbG2DSQoYs/OVOlrpeIdh7PdP0FaZLMFxfwBmxp+hP929yQAAAABJRU5ErkJggg==",
  },
  {
    id: "f-quantum-mage",
    name: "Квантовый маг",
    category: "female",
    description: "Капюшон со звёздами, накидка, голограммы",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACc0lEQVR4Ae3BMUhUcRzA8e/7+ZRUyOVoEoVOoZZrSLCGlhMTdHYQFAW51oYaLOiGgnJocfUGDxwaHZx0cGlRMCQCUzgD5UTowsFBw7t7LxyEHxL/Tu+ene//Ph+Hf0jER30MDo9ymOQLqw5V6O9J5zDYL2xgsrm72IWBcEVfc/OEgVChu5/n0R50jREGQoV+PBkjjATLCVfw/sM8YSFcwetXY4SFYDmnu33Qx6BBmjApe6eYeF4Jk1hb5w4GjW4zJsXSCSZlr4iJcANMvZmJExDhBph+93yHC2JLM3FqwKUCqytT/M2j5DT/y6+B5zvUgFChiZZezk209BIWQoWyx2ucyx6vERYuFXiUnObMx6f3OPNyeYuwcLmEl8tbhI3DBYn4qI9yeJRDyxdWHQweJ174GPw8/IbJTn7ZwaC/J+2j7Bc20DZ3Fx0uQbCcYDnBck53+6CP0iBNaGXvFM3zSmitrXfQ3IZbmJTKv9E8r4hJa9NttEa3Ga1YOkEre0W09e2sg4FgOSFAI8MZRoYz1DOXgHSsZPiUTFHvhIDsJVPcBILlhGvw9m2GeiVcg3Q6Rb1yCcCX7xke3k8RhNjSDNpB3zOqIQTg4f0UF3WsZKhHLtdkL5miFrLHa2gDVMflgsnxBbTZuSEikUgkEolEIpFIJBKJRMLEocYS8VEf5fAoh5YvrDoY9PekfZT9wgba5u6iQw0JlhMsJ1jOoUrd7YM+SoM0oZW9UzTPK6HF2jrRGt1mtGLpBK3sFdHWt7MOVRAsJ1hOsJxgOcFyguUEy7nUmdjSDNpB3zOCJFjOpc5kj9fQBgiWS41Nji+gzc4NUc/+AEG6p8GGWvF/AAAAAElFTkSuQmCC",
  },
  {
    id: "f-mecha-pilot",
    name: "Меха-пилот",
    category: "female",
    description: "Облегающий технокостюм с магента-схемами",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACEklEQVR4Ae3BoW7bQBzA4Z//MmmL4pWM9QVMTMqmslUaWdiYmVnYFTTlGzEeMzGbqmkje4AWFpi4D7AXmKMAO8i6qcDSqZtureJMTu++L+Af1r3WWJRFic0iSwO20Gv9Houi/IJNln74joXgOGHPyPzHN0Yk7Jn553eMSdgzX18zZ0SC4wTHCY4Lbu7uNRazKMJm1TTYbLoWm+j4eI5FFL3Cpml+YdO1LTaC4wTHhTxBrCr+ps4T9p3guJAnqPOEl0pwnOC4gEfWvdYYyqLEtMjSAIt1rzUWZVFis8jSAIt1rzWGsigxLbI04BkExwmOExwX3NzdawxvPv6kzhMGq6bBtOlaTAeHR5hmUYTNqmkwbboWm4PDI0yzKMK0ahpMm67FdH52GmAh7FisKsYWq4qxCI4THCfsSKwqBrGqmCphR+o8YVDnCVMlOE7YkVhVDGJVMVXCjtR5wqDOE6Yq5JG3XIO6ZnC1vOAlCxmZUpf8QV0zuFpeMCUhI8vzT9ismoZtxKriQawqHtwuT/A8z/M8z/M8z/M8z3uOgJGte60xlEWJaZGlARbrXmsMZVFiWmRpwIgExwmOExwXsKWbu3uNYRZFDGJVcbs8wbTpWkwHh0eYZlGEadU0mDZdi+n87DRgC8JExarifxAcJzhOcJzgOMFxguMEx4WMTKlLTFdcMGWC40ImJlYVg1hV3C5P2KXfy8CZhu4JuGgAAAAASUVORK5CYII=",
  },
  {
    id: "n-android",
    name: "Андроид",
    category: "neutral",
    description: "Хромированный корпус с фиолетовой подсветкой",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACQ0lEQVR4Ae3BMWsTYRjA8f89BNIlCVY7CPYDdMg30PU6JBnc5IZ2cyluWbpkLYEMga51aIcDCwHBCNduEifXM/gROkQrd0c0N8hJh8BDh9e0SSTNe7+fwz9Ef7IMg7O3Z5i8eb3vMIcsy55jcPbuPSb7r15+xkCwnGA5wXKC5QTLCZYTLOd8+vI1w+DR5iZTzeYhNzqdI6Z+Xl9j8vvXGJNn29svMNh8/AST6x/fMRmPx5gIlhMsJ1hOmNHF6VOmLk6fsi6EGe3uXzG1u3/FuhBm1GweMtVsHrIuhBl1OkdMdTpHrAuHW4LBMEMJ+j20brvlYBAMhhkGQb+HSbfdcjAIBsMMJej30LrtlsMdCJYTLCdYzjk+Oc9QSuUKWhJHaGk6QSsWN9A+9D9i0qjX0NJ0gkmxuIFWKlfQkjhCS9MJWvNgz8GgwIJ5nodJEkesEsFywhKNQpdR6LLKhCUZhS47Vdipwih0WVUFHhjf99Ea9RrzKHCL7/tojXqN+9iqXvItdLmxVb1kUTzPQ0viiHkUuMXzPLQkjrivreolq06wnGA5wXLCAzQKXUahSy6Xy+VyuVwul8vlcrncfTgsWDAYZihBv4fWbbccDILBMEMJ+j20brvlsECC5QTLCZZzmNPxyXmGUipX0JI4QkvTCVqxuIFWKlfQkjhCS9MJWvNgz2EOguUEywmWEyxXYMX4vo/WqNdYpgIL5vs+WqNe4y48z0NL4ohlKrBgnuehJXHEKhMsJ1hOsJywgkahyyh0+R/+ApMfqpdAleBLAAAAAElFTkSuQmCC",
  },
  {
    id: "n-void-traveler",
    name: "Странник пустоты",
    category: "neutral",
    description: "Тёмный плащ с галактическими узорами",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACRklEQVR4Ae3BP0sjQRjA4d+8/mnEZiEEAjksUlxlk0IEt7S7wurqFFpcGsHmvoVgY6OF9VUW9w3WRjCNhVVSWJiDBBI2EFJoZs4mMIjMRZLNrZl5HsU/FItfDQ6jUYrLYPBHkWOC5wTPCZ4TPCd4TvCc4DkVRVsGB5EVXLQe42KMwaXff1Q4HLSNuS4pxavfv4zh1bfvSvHqoG3MdUkpZqCiaMvgILKCi9ZjXIwxuPT7j4r/SJhSt9tkGQlTKhQqTOzdN1kWwpSuzptMHN6wNIQpXJ03qdUrTNTqFZaFMIVavcJb3W6TZSB8wM8fTSYKhQrLQPFGsbhrsIxGHWyDQUvhUC7vGxyGwydcer0HhUO5vG+wDIdP2Hq9B8UHCJ4TPCd4TkXRtsEisopN6xdsxmhs6+sb2ETWcNH6GZsxY1yUWsEmsoZN62dsxoyxdTp3CgfBc0IGTg4TPgshA6eXMRdnCZ+BkJGj45isXJwlzIvwjqvzBvO200iYl6PjmHkR3lGrV5mndjvhthqTR8IClEoxeSUsSLudkEdCBk4OE94qlWLySMjA6WXMxE4jYZ7StEWatkjTFmnaYlZCxm6rMUEQBEEQBEEQBEEQBHmimLNicddgGY062AaDlsKhXN43WIbDJ2y93oNijgTPCZ4TPKeYURRtGywiq9i0fsFmjMa2vr6BTWQNm9bP2IwZY+t07hQzEDwneE7wnOA5wXOC54Sc2mkkLIKQkb37BrO4rcYsgpCRm+0qn8EqOZOmLWybm1/IkuC5v7wysQthmvsBAAAAAElFTkSuQmCC",
  },
  {
    id: "n-circuit-ghost",
    name: "Цифровой призрак",
    category: "neutral",
    description: "Полупрозрачный силуэт с лаймовыми схемами",
    model: 'classic',
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAADDklEQVR4Ae3BsYrcVhSA4f8ejHG1N7uIDAhWYERqlyIv4Hq39RuoUZM3UaPHcOq8gaoUqQVBhYpFzHJ3GdaMbZ2gInAJwx2CNIN3pO8zHHF9u1EC9rsXQnbbJ8MEv/52f0fAw19/E9L88efvBAgLJyycsHDCwgkLJyycsHDmanOjBPz0y8+4psemEa7psWmEa3psGuGaHh0GQlSVkPcfP9wT8ObdW0K+fdkTMnz9TohwhGt68q7ANT0j1/SMXNNzCYQjbBpRxSU2jRjZNGJk04hLIBzhmp6Ra3pGrukZuabnEghH2DRilHcFI5tG5F2BTSMugbna3CgBRoQQHQZCVJWQ9x8/3BPw5t1bQr592RMyfP1OiHCETSNGNo0Y2TRilHcFl0A4wjU9I9f0jFzTM6rikktg+I/r243i2e9e8O22T4aA69uNErDfvRCy2z4ZAq5vN4pnv3vBt9s+Gf4HYeGEhRMWzlxtbhSPEcFmCa5uGekw4FNVfMYYfEaEEB0GfKpKiDEGnxHBp8OAT1XxPT88GgKEA1zdMoXNEmyWYLMEmyXYLMFmCXPJu4K5CAfYLGGKT5/vcHWLq1s+fb7D1S2ubplLFZfMRTjA1S1TVHHJayEcYLOEueVdwVzyrmAuwgGubplbFZfMpYpL5iIcYLOEpRAOcHXLjyzvCuYiHGCzhKnyruBUqrhkLsIBrm6ZqopL/pV3BT8q4QCbJcypikvmlHcFczFXmxvFY0Tw6TDgU1V8xhh8RgSbJRzi6hYdBnyqSogxBp8RwafDgE9V8T0/PBpWq9VqtVqtVqvVarVarTyGmV3fbhTPfveCb7d9MgRc324Uz373gm+3fTLMSFg4YeGEhTNMdLW5UTxGhJHNElzdosOAT1XxGWPwGRF8Ogz4VBXf88OjYQLhRFzdMkXeFZyDcCI2S5iiikvOQTgRV7e8BsKJ2CxhirwrOAfhRFzdMkUVl5yDcCI2S3gNhBNxdcsUeVdwDsKJ2CxhiiouOQfhRFzd8hoIJ2KzhCnyruAchBNxdcsUVVxyDv8AEYAZ0h5HuAQAAAAASUVORK5CYII=",
  },
];
