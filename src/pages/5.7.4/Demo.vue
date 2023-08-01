<template>
    <div>
        5.7.4
    </div>
</template>

<script setup>
import { reactive, effect } from "@/lib"

const arr = reactive([])

effect(() => {
    arr.push(1)
})
effect(() => {
})

arr.push(1)

</script>

<style lang='less' scoped></style>